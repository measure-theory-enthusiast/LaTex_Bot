const nodemailer = require('nodemailer');
const fetch = require('node-fetch'); // Only required if using Node <18
const { getJSON, setJSON } = require('@netlify/blobs');

const EMAIL_LIMIT = 150;
const BLOB_KEY = 'daily-email-counter';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // Handle preflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: 'OK',
    };
  }

  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: 'Only POST method is allowed',
    };
  }

  const { email, latexCode } = JSON.parse(event.body || '{}');

  if (!email || !latexCode) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing email or LaTeX code' }),
    };
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const counter = (await getJSON(BLOB_KEY)) || {};

  // Remove entries older than 7 days
  for (const date in counter) {
    const age = (new Date(today) - new Date(date)) / (1000 * 60 * 60 * 24);
    if (age > 7) delete counter[date];
  }

  // Check rate limit
  if ((counter[today] || 0) >= EMAIL_LIMIT) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: 'Daily email limit reached' }),
    };
  }

  try {
    const fullLatex = `
\\documentclass{article}
\\usepackage{amsmath, amssymb}
\\usepackage[utf8]{inputenc}
\\pagestyle{empty}
\\begin{document}
${latexCode}
\\end{document}
    `;

    // Convert LaTeX to PDF
    const pdfRes = await fetch('https://latex.ytotech.com/builds/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        compiler: 'pdflatex',
        resources: [{ main: true, content: fullLatex }],
      }),
    });

    if (!pdfRes.ok) {
      const errorText = await pdfRes.text();
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'PDF generation failed', details: errorText }),
      };
    }

    const pdfBuffer = await pdfRes.buffer();

    // Send email
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

    // Update counter
    counter[today] = (counter[today] || 0) + 1;
    await setJSON(BLOB_KEY, counter);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'Email sent successfully' }),
    };

  } catch (err) {
    console.error('Error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Something went wrong', details: err.message }),
    };
  }
};
