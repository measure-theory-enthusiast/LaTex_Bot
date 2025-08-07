const { google } = require('googleapis');

exports.handler = async (event) => {
  try {
    // Load raw private key from env var
    const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY || '';
    console.log('Raw private key preview (first 100 chars):');
    console.log(privateKeyRaw.slice(0, 100));
    console.log('Contains literal \\n?', privateKeyRaw.includes('\\n'));

    // Replace literal \n with real newlines, trim whitespace
    const privateKey = privateKeyRaw.replace(/\\n/g, '\n').trim();

    // Log the processed key start and end to check formatting
    const lines = privateKey.split('\n');
    console.log('Processed private key lines count:', lines.length);
    console.log('--- Processed key start ---');
    console.log(lines.slice(0, 3).join('\n'));
    console.log('...');
    console.log(lines.slice(-3).join('\n'));
    console.log('--- Processed key end ---');

    // Check for any trailing or leading whitespace around BEGIN/END markers
    if (!lines[0].startsWith('-----BEGIN PRIVATE KEY-----')) {
      throw new Error('Private key does not start with expected header line');
    }
    if (!lines[lines.length - 1].startsWith('-----END PRIVATE KEY-----')) {
      throw new Error('Private key does not end with expected footer line');
    }

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
