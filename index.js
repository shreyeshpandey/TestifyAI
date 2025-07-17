const express = require('express');
const { OpenAI } = require('openai');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');  // For DeepSeek API requests
const session = require('express-session');
const msal = require('@azure/msal-node');

dotenv.config();
console.log('OPENAI API KEY:', process.env.OPENAI_API_KEY ? '✅ Loaded' : '❌ Not Loaded');
console.log('DEEPEEK API KEY:', process.env.DEEPSEEK_API_KEY ? '✅ Loaded' : '❌ Not Loaded');

const app = express();
const port = process.env.PORT || 5001;

// Enable CORS
app.use(cors());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Parse JSON
app.use(express.json());

app.use(session({
  secret: 'your-secret-key', // Replace with env secret in production
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS
}));

// OpenAI setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Function to call OpenAI
const fetchOpenAI = async (userStory, caseType) => {
  const prompt = `
    You are a Senior QA Engineer with 10+ years of experience in writing manual test cases for web and mobile applications.

    Your task is to generate detailed manual test cases based on the given User Story, Requirement, or API Description.

    Instructions:
    - Start Test Case IDs from TC-001 and increment sequentially.
    - For each Test Case, provide:
      - Test Case ID
      - Title (short and meaningful)
      - Pre-conditions (if applicable; else write "None")
      - Steps to Execute (clear, numbered steps)
      - Expected Result (precise and testable)
      - Priority (High, Medium, Low)

    Important Rules:
    - Focus ONLY on the information provided. Do not make assumptions beyond the input.
    - For 'Negative' type, create invalid input or error-handling scenarios.
    - For 'Boundary' type, focus on edge value cases (like limits, thresholds).
    - Keep the language professional and concise.
    - Limit each Test Case Title to under 10 words.

    Output Format:
    Return the result in simple plain text, using "|" (pipe symbol) to separate columns like a CSV table.
  `;
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt + '\n\n' + userStory }],
      max_tokens: 1000,
    });
    
    return response.choices[0].message.content.trim();  // Return OpenAI response
  } catch (error) {
    if (error.response && error.response.status === 429) {
      // Rate limit exceeded, fallback to DeepSeek
      console.log('OpenAI rate limit exceeded, falling back to DeepSeek');
      throw new Error('OpenAI rate limit exceeded');
    } else {
      // Handle other errors
      console.log('Error with OpenAI:', error.message);
      throw new Error('OpenAI API error');
    }
  }
};

// Parse the response from Cohere into structured test case objects
const parseTestCases = (testCaseText) => {
    const testCases = [];

    // Split the entire text by newlines and filter for rows containing '|'
    const lines = testCaseText.split('\n').filter(line => line.includes('|'));

    console.log("Parsed Lines:", lines); // Log the lines for debugging

    // Process each line
    lines.forEach((line) => {
      // Split each line by '|' and trim extra spaces
      const fields = line.split('|').map(field => field.trim()).filter(Boolean);

      console.log("Fields in line:", fields); // Log fields for debugging

      // Ensure the first column contains 'TC-', meaning it's a valid test case
      if (fields.length >= 1 && fields[0].startsWith('TC-')) {
        // Ensure there are exactly 6 fields (ID, Title, Type, Pre-Conditions, Steps, Expected Result)
        if (fields.length === 5) {
          const [testCaseId, title, preConditions, steps, expectedResult] = fields;

          // Add the structured test case to the array
          testCases.push({
            testCaseId,
            title,
            preConditions,
            steps,
            expectedResult
          });
        } else {
          console.log("Skipping invalid row due to incorrect number of fields:", fields);  // Log rows that don't have 6 fields
        }
      }
    });

    console.log("Final Test Cases:", testCases); // Log the final test cases array
    return testCases;
  };

// Function to call DeepSeek
const fetchDeepSeek = async (userStory, caseType) => {
  const prompt = `
    Generate detailed test cases based on the following user story:\n\n${userStory}
    Case type: ${caseType}
  `;
  
  try {
    const response = await fetch('https://api.deepseek.com/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({ userStory, caseType }),
    });

    if (!response.ok) {
      // Log the response status and body for deeper debugging
      const errorBody = await response.text();
      console.error('DeepSeek Error:', response.status, errorBody);
      throw new Error(`DeepSeek API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.testCases;  // Return DeepSeek response
  } catch (error) {
    console.error('Error with DeepSeek:', error.message);
    throw new Error('DeepSeek API error');
  }
};

const fetchCohere = async (userStory, caseType) => {
    const apiKey = process.env.COHERE_API_KEY;  // Ensure this key is set in your .env
    const prompt = `
You are a Senior QA Engineer with 10+ years of experience in writing manual test cases for web and mobile applications.

Your task is to generate detailed manual test cases based on the given User Story, Requirement, or API Description.

Instructions:
- Start Test Case IDs from TC-001 and increment sequentially.
- For each Test Case, provide:
  - Test Case ID
  - Title (short and meaningful)
  - Pre-conditions (if applicable; else write "None")
  - Steps to Execute (clear, numbered steps)
  - Expected Result (precise and testable)

Important Rules:
- Focus ONLY on the information provided. Do not make assumptions beyond the input.
- For 'Negative' type, create invalid input or error-handling scenarios.
- For 'Boundary' type, focus on edge value cases (like limits, thresholds).
- Keep the language professional and concise.
- Limit each Test Case Title to under 10 words.

Output Format:
Return the result in plain text with 5 fields separated by "|" symbol:
Test Case ID | Title | Pre-Conditions | Steps | Expected Result

One test case per line, no markdown, no extra explanation.
`;
    
    const bodyData = {
      model: "command-a-03-2025",
      messages: [
        { role: "user", content: prompt + '\n\n' + userStory },
      ],
    };
  
    try {
      // Log the full prompt and user story being sent
      console.log("Sending the following prompt to Cohere:", prompt + '\n\n' + userStory);
  
      const response = await fetch('https://api.cohere.com/v2/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `bearer ${apiKey}`,
        },
        body: JSON.stringify(bodyData),
      });
  
      if (!response.ok) {
        const errorBody = await response.text();
        console.error('Cohere API Error:', response.status, errorBody);
        throw new Error('Cohere API error');
      }
  
      const data = await response.json();
  
      // Log the full API response for debugging
      console.log('Cohere Response:', data);
      // Log the raw content from Cohere before parsing
      console.log('Raw content from Cohere:', JSON.stringify(data.message.content, null, 2));

      const testCaseText = data.message.content.map(part => part.text || '').join('\n');

      if (!testCaseText) {
        console.log('No test case text received from Cohere');
        throw new Error('No text in the first item of content array');
      }

      // Parse the received text and return structured data
      const testCases = parseTestCases(testCaseText);
      return testCases; // Send structured data to frontend
  
    } catch (error) {
      console.error('Error with Cohere:', error.message);
      throw new Error('Cohere API error');
    }
  };

// API route to generate test cases
app.post('/generate-test-cases', async (req, res) => {
    const { userStory, caseType } = req.body;
    
    try {
      // First, attempt to fetch from OpenAI
      const openAIResult = await fetchOpenAI(userStory, caseType);
      console.log('OpenAI Result:', openAIResult); // Log OpenAI result
      return res.json({ testCases: openAIResult });
    } catch (error) {
      // If OpenAI fails, fallback to DeepSeek
      try {
        const deepSeekResult = await fetchDeepSeek(userStory, caseType);
        console.log('DeepSeek Result:', deepSeekResult); // Log DeepSeek result
        return res.json({ testCases: deepSeekResult });
      } catch (fallbackError) {
        // If both OpenAI and DeepSeek fail, fallback to Cohere
        try {
          const cohereResult = await fetchCohere(userStory, caseType);
          console.log('Cohere Result:', cohereResult); // Log Cohere result
          return res.json({ testCases: cohereResult });
        } catch (cohereError) {
          return res.status(500).json({
            message: 'All services failed',
            details: cohereError.message,
          });
        }
      }
    }
  });

// Fetch user stories using OAuth token
app.get('/secure-ado-stories', async (req, res) => {
  const token = req.session.accessToken;
  const organization = req.query.organization;
  const project = req.query.project;

  if (!token) {
    return res.status(401).json({ message: 'Not authenticated. Please login via /auth/login' });
  }

  try {
    const wiqlResponse = await fetch(`https://dev.azure.com/${organization}/${project}/_apis/wit/wiql?api-version=7.1`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: `
          SELECT [System.Id], [System.Title], [System.Description]
          FROM WorkItems
          WHERE [System.WorkItemType] = 'User Story'
          ORDER BY [System.ChangedDate] DESC
        `
      })
    });

    const wiqlData = await wiqlResponse.json();
    const ids = wiqlData.workItems.map(item => item.id).slice(0, 10);

    if (!ids.length) return res.json({ stories: [] });

    const detailsResponse = await fetch(`https://dev.azure.com/${organization}/${project}/_apis/wit/workitems?ids=${ids.join(',')}&$expand=all&api-version=7.1`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const detailsData = await detailsResponse.json();
    const stories = detailsData.value.map(item => ({
      id: item.id,
      title: item.fields['System.Title'],
      description: item.fields['System.Description'] || 'No description'
    }));

    res.json({ stories });
  } catch (err) {
    console.error('OAuth ADO Fetch Error:', err.message);
    res.status(500).json({ message: 'Failed to fetch user stories via OAuth', error: err.message });
  }
});
  // Fetch user stories from Azure DevOps
app.post('/fetch-ado-stories', async (req, res) => {
  const { organization, project } = req.body;

  try {
    const auth = Buffer.from(`:${process.env.ADO_PAT}`).toString('base64');

    // 1. WIQL query to get story IDs
    const wiqlResponse = await fetch(`https://dev.azure.com/${organization}/${project}/_apis/wit/wiql?api-version=7.1`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: `
          SELECT [System.Id], [System.Title], [System.Description]
          FROM WorkItems
          WHERE [System.WorkItemType] = 'User Story'
          ORDER BY [System.ChangedDate] DESC
        `
      })
    });

    const wiqlData = await wiqlResponse.json();
    const ids = wiqlData.workItems.map(item => item.id).slice(0, 10); // limit to 10

    if (ids.length === 0) return res.json({ stories: [] });

    // 2. Get full details
    const detailsResponse = await fetch(`https://dev.azure.com/${organization}/${project}/_apis/wit/workitems?ids=${ids.join(',')}&$expand=all&api-version=7.1`, {
      headers: { 'Authorization': `Basic ${auth}` }
    });

    const detailsData = await detailsResponse.json();
    const stories = detailsData.value.map(item => ({
      id: item.id,
      title: item.fields['System.Title'],
      description: item.fields['System.Description'] || 'No description'
    }));

    res.json({ stories });
  } catch (error) {
    console.error('ADO Fetch Error:', error.message);
    res.status(500).json({ message: 'Failed to fetch user stories', error: error.message });
  }
});

const msalConfig = {
  auth: {
    clientId: process.env.AZ_CLIENT_ID,
    authority: 'https://login.microsoftonline.com/common',
    clientSecret: process.env.AZ_CLIENT_SECRET,
  }
};

const cca = new msal.ConfidentialClientApplication(msalConfig);

// OAuth login endpoint
app.get('/auth/login', async (req, res) => {
  try {
    const authUrl = await cca.getAuthCodeUrl({
      scopes: ['499b84ac-1321-427f-aa17-267ca6975798/.default'],
      redirectUri: process.env.PROD_REDIRECT_URI
    });
    res.redirect(authUrl);
  } catch (err) {
    console.error('Auth URL error:', err.message);
    res.status(500).send('Failed to initiate login');
  }
});

// OAuth redirect callback
app.get('/auth/callback', async (req, res) => {
  const code = req.query.code;
  try {
    const tokenResponse = await cca.acquireTokenByCode({
      code,
      scopes: ['499b84ac-1321-427f-aa17-267ca6975798/.default'],
      redirectUri: process.env.PROD_REDIRECT_URI
    });

    req.session.accessToken = tokenResponse.accessToken;

    res.send(`
      <script>
        window.opener.postMessage('ado-auth-success', '*');
        window.close();
      </script>
    `);
  } catch (err) {
    console.error('Token error:', err.message);
    res.status(500).send('Token exchange failed');
  }
});

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 Fallback
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Start the server
app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});

// app.post('/generate-automation-script', (req, res) => {
//     const { userStory, caseType, scriptType } = req.body;
  
//     let script = '';
    
//     // Example logic for script generation based on scriptType
//     if (scriptType === 'selenium') {
//       script = `// Selenium Script for ${caseType} case\n// User Story: ${userStory}\n\n// Your Selenium code here...`;
//     } else if (scriptType === 'cypress') {
//       script = `// Cypress Script for ${caseType} case\n// User Story: ${userStory}\n\n// Your Cypress code here...`;
//     } else if (scriptType === 'playwright') {
//       script = `// Playwright Script for ${caseType} case\n// User Story: ${userStory}\n\n// Your Playwright code here...`;
//     }
  
//     res.json({ script });
//   });