const nodemailer = require('nodemailer');
const fetch = require('node-fetch');
const { google } = require('googleapis');

const EMAIL_LIMIT = 100;
const SHEET_ID = process.env.GOOGLE_SHEET_ID; // Google Sheet ID
const SHEET_RANGE = 'Sheet1!A:B'; // Sheet range

const headers = {
  'Access-Control-Allow-Origin': '*', // Adjust as needed for your frontend domain
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Initialize Google Sheets API client
function getSheetsClient() {
  const creds = {
    type: 'service_account',
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.GOOGLE_SHEETS_EMAIL,
  };

  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
  const auth = new google.auth.JWT(creds.client_email, null, creds.private_key, scopes);
  return google.sheets({ version: 'v4', auth });
}

// Read count for today from sheet
async function readCount(sheets, today) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGE,
  });

  const rows = res.data.values || [];

  for (const row of rows) {
    if (row[0] === today) {
      return Number(row[1]) || 0;
    }
  }
  return 0;
}

// Write count for today to sheet (update or append)
async function writeCount(sheets, today, count) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGE,
  });

  const rows = res.data.values || [];

  let rowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === today) {
      rowIndex = i;
      break;
    }
  }

  if (rowIndex >= 0) {
    // Update existing count (column B)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Sheet1!B${rowIndex + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[count]] },
    });
  } else {
    // Append new row with date and count
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: SHEET_RANGE,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[today, count]] },
    });
  }
}

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

  try {
    const sheets = getSheetsClient();
    let count = await readCount(sheets, today);

    if (count >= EMAIL_LIMIT) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ error: '🚫 Daily email limit reached. Try again tomorrow.' }),
      };
    }

    // Prepare LaTeX document
    const tex = `
\\documentclass{article}
\\usepackage{amsmath, amssymb}
\\usepackage[utf8]{inputenc}
\\pagestyle{empty}
\\begin{document}
${latexCode}
\\end{document}
`;

    // Generate PDF
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

    // Increment count & save to sheet
    await writeCount(sheets, today, count + 1);

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
