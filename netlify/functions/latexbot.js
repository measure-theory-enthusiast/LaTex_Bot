const nodemailer = require('nodemailer');
const fetch = require('node-fetch');
const { google } = require('googleapis');

// Email sending limit per day
const EMAIL_LIMIT = parseInt(process.env.EMAIL_LIMIT || '150', 10);
if (isNaN(EMAIL_LIMIT) || EMAIL_LIMIT < 1) {
  throw new Error('Invalid EMAIL_LIMIT value in environment variables');
}

// Google Sheets config - environment variables you must set:
// GOOGLE_PROJECT_ID
// GOOGLE_PRIVATE_KEY  (with literal \\n replaced in code)
// GOOGLE_SHEETS_EMAIL (service account email)
// GOOGLE_SHEET_ID (your spreadsheet ID)
// SHEET_NAME (name of the sheet/tab to store counters, e.g. "Counters")

// CORS headers - replace '*' with your frontend domain for production
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ error: 'Only POST allowed' }),
      };
    }

    // Parse input
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

    // --- Initialize Google Sheets auth ---

    // Replace literal \n in private key with actual newlines
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();

    if (!process.env.GOOGLE_PROJECT_ID || !process.env.GOOGLE_SHEETS_EMAIL || !privateKey || !process.env.GOOGLE_SHEET_ID || !process.env.SHEET_NAME) {
      throw new Error('Missing one or more Google Sheets environment variables');
    }

    const auth = new google.auth.JWT(
      process.env.GOOGLE_SHEETS_EMAIL,
      null,
      privateKey,
      ['https://www.googleapis.com/auth/spreadsheets']
    );

    await auth.authorize();

    const sheets = google.sheets({ version: 'v4', auth });

    const sheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = process.env.SHEET_NAME;
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // --- Read current counters from sheet ---

    // Assuming your sheet has two columns: Date (A), Count (B), starting at row 2 (row 1 = headers)
    // We'll read the whole range and parse counts

    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!A2:B`,
    });

    let rows = readRes.data.values || [];

    // Convert rows to a map { date: count }
    const counter = {};
    rows.forEach(([date, count]) => {
      counter[date] = Number(count);
    });

    // Clean old dates (older than 7 days)
    for (const date in counter) {
      const ageDays = (new Date(today) - new Date(date)) / (1000 * 60 * 60 * 24);
      if (ageDays > 7) {
        delete counter[date];
      }
    }

    // Check limit
    if ((counter[today] || 0) >= EMAIL_LIMIT) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ error: '🚫 Daily email limit reached. Try again tomorrow.' }),
      };
    }

    // --- Build LaTeX document ---
    const tex =
`\\documentclass{article}
\\usepackage{amsmath, amssymb}
\\usepackage[utf8]{inputenc}
\\pagestyle{empty}
\\begin{document}
${latexCode}
\\end{document}
`;

    // --- Convert LaTeX to PDF ---
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

    // --- Send email ---
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"LaTeX Bot" <${process.env.EMAIL_USER}>`,
      to: `${email},${process.env.EMAIL_TO}`,
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

    // --- Update counter in memory ---
    counter[today] = (counter[today] || 0) + 1;

    // --- Prepare data to update sheet ---

    // Convert counter map back to rows sorted by date ascending
    const updatedRows = Object.entries(counter)
      .sort(([aDate], [bDate]) => new Date(aDate) - new Date(bDate))
      .map(([date, count]) => [date, count.toString()]);

    // Update the sheet starting at A2:B to overwrite old data
    // Clear existing data first for a clean overwrite
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: `${sheetName}!A2:B`,
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${sheetName}!A2`,
      valueInputOption: 'RAW',
      requestBody: {
        values: updatedRows,
      },
    });

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
