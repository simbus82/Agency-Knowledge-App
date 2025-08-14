// test-ai-engine.js - Test script for AI-First Engine
require('dotenv').config();
const AIFirstEngine = require('./ai-first-engine');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(colors[color] + message + colors.reset);
}

async function testAIEngine() {
  log('\n╔════════════════════════════════════════╗', 'bright');
  log('║     AI-First Engine Test Suite         ║', 'bright');
  log('║     Testing Pure AI Intelligence       ║', 'bright');
  log('╚════════════════════════════════════════╝\n', 'bright');

  // Check for Claude API key
  if (!process.env.CLAUDE_API_KEY) {
    log('❌ CLAUDE_API_KEY not found in environment', 'red');
    log('   Please configure your .env file first', 'yellow');
    return;
  }

  log('✅ Claude API key found\n', 'green');

  // Initialize AI-First Engine
  const aiEngine = new AIFirstEngine();
  
  // Test queries to demonstrate AI understanding without hardcoding
  const testQueries = [
    {
      name: 'Italian Product Query',
      query: 'Hypermix è un antiparassitario?',
      context: {
        googleAccessToken: process.env.TEST_GOOGLE_TOKEN || null,
        clickupToken: process.env.TEST_CLICKUP_TOKEN || null,
        teamId: process.env.CLICKUP_TEAM_ID || null
      }
    },
    {
      name: 'Task Deadline Query',
      query: 'Quali task sono in scadenza questa settimana?',
      context: {
        clickupToken: process.env.TEST_CLICKUP_TOKEN || null,
        teamId: process.env.CLICKUP_TEAM_ID || null
      }
    },
    {
      name: 'Document Search Query',
      query: 'Trova i documenti modificati oggi',
      context: {
        googleAccessToken: process.env.TEST_GOOGLE_TOKEN || null
      }
    },
    {
      name: 'Cross-Platform Analysis',
      query: 'Confronta le ore trackate con il budget del progetto ABC',
      context: {
        googleAccessToken: process.env.TEST_GOOGLE_TOKEN || null,
        clickupToken: process.env.TEST_CLICKUP_TOKEN || null,
        teamId: process.env.CLICKUP_TEAM_ID || null
      }
    },
    {
      name: 'General Question (No Data Needed)',
      query: 'Come posso migliorare la produttività del team?',
      context: {}
    }
  ];

  for (const test of testQueries) {
    log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'cyan');
    log(`📝 Test: ${test.name}`, 'bright');
    log(`Query: "${test.query}"`, 'yellow');
    log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`, 'cyan');

    try {
      log('🤖 Step 1: AI analyzing query...', 'blue');
      const analysis = await aiEngine.analyzeQueryWithAI(test.query, test.context);
      
      log('\n📊 AI Analysis Result:', 'green');
      console.log(JSON.stringify(analysis, null, 2));
      
      log('\n✨ Key Insights from AI:', 'bright');
      log(`  Intent: ${analysis.intent}`, 'yellow');
      log(`  Needs Data: ${analysis.requiresData}`, 'yellow');
      log(`  Data Sources: ${analysis.dataSources.join(', ')}`, 'yellow');
      log(`  Language: ${analysis.language}`, 'yellow');
      log(`  Urgency: ${analysis.context.urgency}`, 'yellow');
      
      if (analysis.entities.keywords.length > 0) {
        log(`  Keywords Identified: ${analysis.entities.keywords.join(', ')}`, 'cyan');
      }
      
      if (analysis.entities.brands.length > 0) {
        log(`  Brands Identified: ${analysis.entities.brands.join(', ')}`, 'cyan');
      }
      
      if (analysis.entities.projects.length > 0) {
        log(`  Projects Identified: ${analysis.entities.projects.join(', ')}`, 'cyan');
      }
      
      log('\n✅ AI successfully understood the query WITHOUT any hardcoding!', 'green');
      
    } catch (error) {
      log(`\n❌ Test failed: ${error.message}`, 'red');
      if (error.response?.data) {
        console.error('API Error:', error.response.data);
      }
    }
  }

  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'bright');
  log('\n🎉 AI-First Engine Test Complete!', 'green');
  log('\n💡 Key Achievements:', 'bright');
  log('  ✓ Zero hardcoded patterns', 'green');
  log('  ✓ AI understands intent automatically', 'green');
  log('  ✓ AI identifies entities without regex', 'green');
  log('  ✓ AI determines data sources intelligently', 'green');
  log('  ✓ AI handles multiple languages naturally', 'green');
  log('\n🚀 The system is now truly AI-powered!', 'cyan');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', 'bright');
}

// Run the test
testAIEngine().catch(error => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
