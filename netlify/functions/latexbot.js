const nodemailer = require('nodemailer');
const fetch = require('node-fetch');

const EMAIL_LIMIT = 150;
const BLOB_KEY = 'daily-email-counter';

// Change '*' to your frontend domain for better security if you want
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

let getJSON, setJSON;

exports.handler = async (event) => {
  try {
    // Dynamically import @netlify/blobs ESM module once
    if (!getJSON || !setJSON) {
      const blobsModule = await import('@netlify/blobs');
      const blobs = blobsModule.default || blobsModule;
      getJSON = blobs.getJSON;
      setJSON = blobs.setJSON;
    }

    // Handle preflight CORS
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers,
        body: 'OK',
      };
    }

    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ error: 'Only POST allowed' }),
      };
    }

    // Parse and validate input
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

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const counter = (await getJSON(BLOB_KEY)) || {};

    // Clean up old entries
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

    // Wrap LaTeX code
    const tex = `
\\documentclass{article}
\\usepackage{amsmath, amssymb}
\\usepackage[utf8]{inputenc}
\\pagestyle{empty}
\\begin{document}
${latexCode}
\\end{document}
`;

    // Send LaTeX to PDF conversion API
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

    // Send the email
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

    // Increment the counter and store
    counter[today] = (counter[today] || 0) + 1;
    await setJSON(BLOB_KEY, counter);

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
