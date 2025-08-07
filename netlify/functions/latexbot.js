const { google } = require('googleapis');

exports.handler = async (event) => {
  try {
    // Load raw private key from env var
    const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY || '';
    console.log('Raw private key preview:', privateKeyRaw.slice(0, 60)); // shows with \n

    // Replace literal \n with real newlines, trim whitespace
    const privateKey = privateKeyRaw.replace(/\\n/g, '\n').trim();
    console.log('Processed private key preview:\n', privateKey.slice(0, 60)); // shows with real newlines

    const creds = {
      type: 'service_account',
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key: privateKey,
      client_email: process.env.GOOGLE_SHEETS_EMAIL,
    };

    // Initialize JWT client with scopes
    const auth = new google.auth.JWT(
      creds.client_email,
      null,
      creds.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );

    // Attempt to authorize
    await auth.authorize();

    console.log('✅ Authorization successful!');

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Authorization successful!' }),
    };
  } catch (err) {
    console.error('❌ Authorization error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Authorization failed',
        message: err.message,
        stack: err.stack,
      }),
    };
  }
};
