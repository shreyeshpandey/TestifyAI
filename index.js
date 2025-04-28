const express = require('express');
const { OpenAI } = require('openai');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');  // For DeepSeek API requests

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
        // Ensure there are exactly 5 fields (ID, Title, Pre-Conditions, Steps, Expected Result)
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
          console.log("Skipping invalid row due to incorrect number of fields:", fields);  // Log rows that don't have 5 fields
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
      Return the result in simple plain text, using "|" (pipe symbol) to separate columns like a CSV table.
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
  
      const testCaseText = data.message.content[0].text;
  
      if (!testCaseText) {
        console.log('No test case text received from Cohere');
        throw new Error('No text in the first item of content array');
      }
  
      // Parse the received text and return structured data
    //   console.log(testCaseText);
      const testCases = parseTestCases(testCaseText);
    //   console.log("testCases:",testCases);
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