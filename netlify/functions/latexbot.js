const nodemailer = require('nodemailer');
const fetch = require('node-fetch');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
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
      body: 'Only POST allowed',
    };
  }

  const { email, latexCode } = JSON.parse(event.body);
  if (!email || !latexCode) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing fields' }),
    };
  }

  try {
    const tex = `
\\documentclass{article}
\\usepackage{amsmath}
\\begin{document}
${latexCode}
\\end{document}
`;

    const apiResponse = await fetch('https://latex.ytotech.com/builds/sync', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    compiler: 'pdflatex',
    resources: [
      {
        main: true,
        content: latexCode,
      },
    ]
  })
});

    const pdfBuffer = await response.buffer();

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
      attachments: [{
        filename: 'output.pdf',
        content: pdfBuffer,
        contentType: 'application/pdf',
      }],
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'Email sent!' }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Something went wrong' }),
    };
  }
};
