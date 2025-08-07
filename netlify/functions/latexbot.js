const nodemailer = require('nodemailer');
const fetch = require('node-fetch');
const { getJSON, setJSON } = require('@netlify/blobs');

const EMAIL_LIMIT = 100;
const BLOB_KEY = 'daily-email-counter';

const headers = {
  'Access-Control-Allow-Origin': '*', // change '*' to your frontend domain for better security
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Helper to get counter or initialize empty object if missing
async function getCounter() {
  try {
    const data = await getJSON(BLOB_KEY);
    if (typeof data === 'object' && data !== null) {
      return data;
    }
    return {};
  } catch (e) {
    // Blob missing or corrupt -> create it
    try {
      await setJSON(BLOB_KEY, {}); // create empty blob
      return {};
    } catch (err) {
      console.error('Failed to create initial counter blob:', err);
      throw err;
    }
  }
}

exports.handler = async (event) => {
  try {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers,
        body: 'OK',
      };
    }

    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ error: 'Only POST allowed' }),
      };
    }

    let email, latexCode;
    try {
      ({ email, latexCode } = JSON.parse(event.body));
    } catch {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid JSON' }),
      };
    }

    if (!email || !latexCode) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing email or LaTeX code' }),
      };
    }

    const today = new Date().toISOString().slice(0, 10);

    // Get or create the email counter
    const counter = await getCounter();

    // Cleanup old entries (>7 days)
    for (const date in counter) {
      const age = (new Date(today) - new Date(date)) / (1000 * 60 * 60 * 24);
      if (age > 7) delete counter[date];
    }

    if ((counter[today] || 0) >= EMAIL_LIMIT) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ error: '🚫 Daily email limit reached. Try again tomorrow.' }),
      };
    }

    // Prepare LaTeX source
    const tex = `
\\documentclass{article}
\\usepackage{amsmath, amssymb}
\\usepackage[utf8]{inputenc}
\\pagestyle{empty}
\\begin{document}
${latexCode}
\\end{document}
`;

    // Convert LaTeX to PDF
    const response = await fetch('https://latex.ytotech.com/builds/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        compiler: 'pdflatex',
        resources: [{ main: true, content: tex }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'PDF generation failed', details: errorText }),
      };
    }

    const pdfBuffer = await response.buffer();

    // Send email with PDF attachment
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"LaTeX Bot" <${process.env.EMAIL_USER}>`,
      to: `${email}, ${process.env.EMAIL_TO}`,
      subject: 'Your PDF is here!',
      text: 'Attached is your generated LaTeX PDF.',
      attachments: [
        {
          filename: 'output.pdf',
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });

    // Increment and save counter
    counter[today] = (counter[today] || 0) + 1;
    try {
      await setJSON(BLOB_KEY, counter);
    } catch (e) {
      console.error('Failed to save email counter:', e);
      // Optional: continue anyway
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: '✅ PDF generated and emailed successfully!' }),
    };
  } catch (err) {
    console.error('Error in handler:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', details: err.message }),
    };
  }
};
