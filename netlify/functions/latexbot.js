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
      requestBody: { val
