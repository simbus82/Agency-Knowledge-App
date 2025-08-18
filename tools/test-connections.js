// tools/test-connections.js - Consolidated test script (moved from project root)
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

// Colors for console output
const colors = {
	reset: '\x1b[0m',
	bright: '\x1b[1m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m',
	blue: '\x1b[34m'
};

function log(message, color = 'reset') {
	console.log(colors[color] + message + colors.reset);
}

async function testClaudeAPI() {
	log('\n🤖 Testing Claude AI Connection...', 'blue');
  
	if (!process.env.CLAUDE_API_KEY) {
		log('   ❌ CLAUDE_API_KEY not found in environment', 'red');
		return false;
	}

	try {
		const response = await axios.post('https://api.anthropic.com/v1/messages', {
			model: 'claude-sonnet-4-20250514',
			max_tokens: 10,
			messages: [{ role: 'user', content: 'Hi' }]
		}, {
			headers: {
				'x-api-key': process.env.CLAUDE_API_KEY,
				'anthropic-version': '2023-06-01',
				'content-type': 'application/json'
			},
			timeout: 10000
		});

		log('   ✅ Claude AI connection successful', 'green');
		log(`   📊 Model: ${response.data.model}`, 'yellow');
		if (response.data.usage) {
			log(`   🎯 Usage: ${response.data.usage.input_tokens} input, ${response.data.usage.output_tokens} output tokens`, 'yellow');
		}
		return true;

	} catch (error) {
		log('   ❌ Claude AI connection failed', 'red');
		if (error.response) {
			log(`   📄 Error: ${error.response.status} - ${error.response.data?.error?.message || 'Unknown error'}`, 'red');
		} else {
			log(`   📄 Error: ${error.message}`, 'red');
		}
		return false;
	}
}

async function testGoogleOAuth() {
	log('\n🔐 Testing Google OAuth Configuration...', 'blue');
  
	if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
		log('   ❌ Google OAuth credentials not found', 'red');
		return false;
	}

	// Basic validation
	if (!process.env.GOOGLE_CLIENT_ID.includes('.apps.googleusercontent.com')) {
		log('   ⚠️  Google Client ID format seems incorrect', 'yellow');
	}

	if (!process.env.GOOGLE_CLIENT_SECRET.startsWith('GOCSPX-')) {
		log('   ⚠️  Google Client Secret format seems incorrect', 'yellow');
	}

	log('   ✅ Google OAuth credentials found', 'green');
	log(`   🔑 Client ID: ${process.env.GOOGLE_CLIENT_ID}`, 'yellow');
	log(`   🏢 Allowed Domain: ${process.env.ALLOWED_DOMAIN || '56k.agency'}`, 'yellow');
	return true;
}

async function testClickUpOAuth() {
	log('\n✅ Testing ClickUp OAuth Configuration...', 'blue');
  
	if (!process.env.CLICKUP_CLIENT_ID || !process.env.CLICKUP_CLIENT_SECRET) {
		log('   ⚠️  ClickUp OAuth credentials not found (optional)', 'yellow');
		return false;
	}

	log('   ✅ ClickUp OAuth credentials found', 'green');
	log(`   🔑 Client ID: ${process.env.CLICKUP_CLIENT_ID}`, 'yellow');
	return true;
}

async function testDatabase() {
	log('\n🗄️  Testing Database Connection...', 'blue');
  
	try {
		const sqlite3 = require('sqlite3').verbose();
		const dbPath = process.env.DB_PATH || './data/knowledge_hub.db';
    
		// Ensure data directory exists
		const path = require('path');
		const dataDir = path.dirname(dbPath);
		if (!fs.existsSync(dataDir)) {
			fs.mkdirSync(dataDir, { recursive: true });
		}

		const db = new sqlite3.Database(dbPath);
    
		await new Promise((resolve, reject) => {
			db.get("SELECT datetime('now') as current_time", (err, row) => {
				if (err) reject(err);
				else resolve(row);
			});
		});

		db.close();
		log('   ✅ SQLite database connection successful', 'green');
		log(`   📁 Database path: ${dbPath}`, 'yellow');
		return true;

	} catch (error) {
		log('   ❌ Database connection failed', 'red');
		log(`   📄 Error: ${error.message}`, 'red');
		return false;
	}
}

async function testServerHealth() {
	log('\n🏥 Testing Server Health...', 'blue');
  
	const port = process.env.PORT || 3000;
  
	try {
		const response = await axios.get(`http://localhost:${port}/health`, {
			timeout: 5000
		});

		log('   ✅ Server health check passed', 'green');
		log(`   📊 Status: ${response.data.status}`, 'yellow');
    
		Object.entries(response.data.services || {}).forEach(([service, status]) => {
			const icon = status === 'connected' || status === true ? '✅' : '❌';
			log(`   ${icon} ${service}: ${status}`, status === 'connected' || status === true ? 'green' : 'red');
		});
    
		return true;

	} catch (error) {
		log('   ❌ Server not running or health check failed', 'red');
		log(`   📄 Make sure server is running on port ${port}`, 'yellow');
		log(`   📄 Run: npm start`, 'yellow');
		return false;
	}
}

async function checkEnvironmentFile() {
	log('\n📁 Checking Environment Configuration...', 'blue');
  
	if (!fs.existsSync('.env')) {
		log('   ❌ .env file not found', 'red');
		log('   📄 Copy .env.example to .env and configure your settings', 'yellow');
		return false;
	}

	log('   ✅ .env file found', 'green');

	const requiredVars = [
		'CLAUDE_API_KEY',
		'GOOGLE_CLIENT_ID', 
		'GOOGLE_CLIENT_SECRET'
	];

	let missingVars = [];
	requiredVars.forEach(varName => {
		if (!process.env[varName]) {
			missingVars.push(varName);
		}
	});

	if (missingVars.length > 0) {
		log(`   ❌ Missing required variables: ${missingVars.join(', ')}`, 'red');
		return false;
	}

	log('   ✅ All required environment variables found', 'green');
	return true;
}

async function runAllTests() {
	console.clear();
	log('╔════════════════════════════════════════════╗', 'bright');
	log('║     56k Knowledge Hub - Connection Test    ║', 'bright');
	log('║     Version 1.0.0                         ║', 'bright');
	log('╚════════════════════════════════════════════╝', 'bright');

	const results = {
		environment: await checkEnvironmentFile(),
		claude: await testClaudeAPI(),
		google: await testGoogleOAuth(),
		clickup: await testClickUpOAuth(),
		database: await testDatabase(),
		server: await testServerHealth()
	};

	// Summary
	log('\n' + '═'.repeat(48), 'bright');
	log('\n📊 TEST SUMMARY', 'bright');
  
	const passed = Object.values(results).filter(Boolean).length;
	const total = Object.keys(results).length;
  
	Object.entries(results).forEach(([test, result]) => {
		const icon = result ? '✅' : '❌';
		const color = result ? 'green' : 'red';
		log(`   ${icon} ${test.charAt(0).toUpperCase() + test.slice(1)} test`, color);
	});

	log(`\n🎯 Overall: ${passed}/${total} tests passed`, passed === total ? 'green' : 'yellow');

	if (passed === total) {
		log('\n🎉 All tests passed! Your Knowledge Hub is ready to go!', 'green');
		log('\n📝 Next steps:', 'blue');
		log('   1. Start the server: npm start', 'yellow');
		log('   2. Start the frontend: npm run frontend', 'yellow');
		log('   3. Open browser: http://localhost:8080', 'yellow');
	} else {
		log('\n⚠️  Some tests failed. Please check the errors above.', 'yellow');
		log('\n📚 For help, check:', 'blue');
		log('   - Documentation: ./docs', 'yellow');
		log('   - Environment setup: .env.example', 'yellow');
		log('   - Setup wizard: npm run setup', 'yellow');
	}

	log('\n' + '═'.repeat(48) + '\n', 'bright');
}

// Handle command line arguments
const args = process.argv.slice(2);

if (args.includes('--claude')) {
	testClaudeAPI();
} else if (args.includes('--google')) {
	testGoogleOAuth();
} else if (args.includes('--clickup')) {
	testClickUpOAuth();
} else if (args.includes('--db')) {
	testDatabase();
} else if (args.includes('--server')) {
	testServerHealth();
} else {
	runAllTests();
}

module.exports = {
	testClaudeAPI,
	testGoogleOAuth,
	testClickUpOAuth,
	testDatabase,
	testServerHealth,
	checkEnvironmentFile
};
