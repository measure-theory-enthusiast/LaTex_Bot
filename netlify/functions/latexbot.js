const nodemailer = require('nodemailer');
const fetch = require('node-fetch');

const EMAIL_LIMIT = 100;
const BLOB_KEY = 'daily-email-counter';

const headers = {
  'Access-Control-Allow-Origin': '*', // replace '*' with your frontend origin for security
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  // Dynamic import of ES module @netlify/blobs
  const { getJSON, setJSON } = await import('@netlify/blobs');

  try {
    // Handle preflight CORS
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

    // Load or initialize counter blob
    let counter;
    try {
      counter = await getJSON(BLOB_KEY);
      if (typeof counter !== 'object' || counter === null) counter = {};
    } catch {
      // Blob doesn't exist, create empty
      counter = {};
      await setJSON(BLOB_KEY, counter);
    }

    // Remove entries older than 7 days
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

    // Convert LaTeX to PDF via ytotech API
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

    // Increment counter and save
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
