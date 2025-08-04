const nodemailer = require('nodemailer');
const fetch = require('node-fetch');

// Set CORS headers so your GitHub Pages frontend can call this API
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  // Handle preflight (CORS) request
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
      body: 'Only POST allowed',
    };
  }

  // Parse and validate the body
  const { email, latexCode } = JSON.parse(event.body);
  if (!email || !latexCode) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing email or LaTeX code' }),
    };
  }

  try {
    // 🔧 Wrap LaTeX code in a full document
    const tex = `
\\documentclass{article}
\\usepackage{amsmath, amssymb}
\\usepackage[utf8]{inputenc}
\\pagestyle{empty}
\\begin{document}
\\[
${latexCode}
\\]
\\end{document}
`;

    // 🧾 Send LaTeX to the PDF conversion API
    const response = await fetch('https://latex.ytotech.com/builds/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        compiler: 'pdflatex',
        resources: [
          {
            main: true,
            content: tex,  // ✅ Fixed: use the full LaTeX document
          },
        ],
      }),
    });

    // Check if API call succeeded
    if (!response.ok) {
      const errorText = await response.text();
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to generate PDF', details: errorText }),
      };
    }

    const pdfBuffer = await response.buffer();

    // 📬 Configure email transport using Gmail
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // 📎 Send the PDF to the user and your backup email
    await transporter.sendMail({
      from: `"LaTeX Bot" <${process.env.EMAIL_USER}>`,
      to: `${email}, ${process.env.EMAIL_TO}`, // you + the user
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

    // ✅ Success response
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
