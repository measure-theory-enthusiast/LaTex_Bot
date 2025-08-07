const nodemailer = require('nodemailer');
const fetch = require('node-fetch');
const { getJSON, setJSON } = require('@netlify/blobs');

// Constants
const EMAIL_LIMIT = 150;
const BLOB_KEY = 'daily-email-counter';

exports.handler = async (event) => {
  // ✅ Immediate CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // ✅ Handle preflight request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204, // No content
      headers: corsHeaders,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Only POST allowed' }),
    };
  }

  const { email, latexCode } = JSON.parse(event.body || '{}');

  if (!email || !latexCode) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing email or LaTeX code' }),
    };
  }

  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const counter = (await getJSON(BLOB_KEY)) || {};

  // 🧼 Remove old dates (7-day retention)
  const maxAge = 7;
  for (const date in counter) {
    const age = (new Date(today) - new Date(date)) / (1000 * 60 * 60 * 24);
    if (age > maxAge) delete counter[date];
  }

  if ((counter[today] || 0) >= EMAIL_LIMIT) {
    return {
      statusCode: 429,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Daily email limit reached' }),
    };
  }

  try {
    // 🧾 LaTeX document
    const tex = `
\\documentclass{article}
\\usepackage{amsmath, amssymb}
\\usepackage[utf8]{inputenc}
\\pagestyle{empty}
\\begin{document}
${latexCode}
\\end{document}
`;

    // 🛠 Convert to PDF
    const pdfResponse = await fetch('https://latex.ytotech.com/builds/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        compiler: 'pdflatex',
        resources: [{ main: true, content: tex }],
      }),
    });

    if (!pdfResponse.ok) {
      const errorText = await pdfResponse.text();
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to generate PDF', details: errorText }),
      };
    }

    const pdfBuffer = await pdfResponse.buffer();

    // 📬 Email it
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

    // ✅ Count this email
    counter[today] = (counter[today] || 0) + 1;
    await setJSON(BLOB_KEY, counter);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Email sent successfully' }),
    };

  } catch (err) {
    console.error('Error sending email:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Something went wrong', details: err.message }),
    };
  }
};
