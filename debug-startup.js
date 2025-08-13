// debug-startup.js - Script per debug problemi di avvio
const axios = require('axios');
const fs = require('fs');

async function debugStartup() {
  console.log('🔍 Debug avvio 56k Knowledge Hub...\n');

  // 1. Verifica file .env
  console.log('1️⃣ Controllo file .env...');
  if (!fs.existsSync('.env')) {
    console.log('❌ File .env non trovato!');
    console.log('   Copia .env.example in .env e configura le API keys');
    return;
  }
  console.log('✅ File .env trovato');

  // 2. Verifica dipendenze
  console.log('\n2️⃣ Controllo dipendenze...');
  if (!fs.existsSync('node_modules')) {
    console.log('❌ node_modules non trovato!');
    console.log('   Esegui: npm install');
    return;
  }
  console.log('✅ Dipendenze installate');

  // 3. Test backend
  console.log('\n3️⃣ Test backend (porta 3000)...');
  try {
    const response = await axios.get('http://localhost:3000/health', { timeout: 5000 });
    console.log('✅ Backend attivo:', response.data.status);
  } catch (error) {
    console.log('❌ Backend non raggiungibile!');
    console.log('   Avvia con: npm start');
    return;
  }

  // 4. Test frontend
  console.log('\n4️⃣ Test frontend (porta 8080)...');
  try {
    const response = await axios.get('http://localhost:8080', { timeout: 5000 });
    console.log('✅ Frontend attivo');
  } catch (error) {
    console.log('❌ Frontend non raggiungibile!');
    console.log('   Avvia con: npm run frontend');
    return;
  }

  // 5. Test route OAuth
  console.log('\n5️⃣ Test route OAuth...');
  try {
    const response = await axios.get('http://localhost:3000/auth/google', { 
      maxRedirects: 0,
      validateStatus: (status) => status === 302
    });
    console.log('✅ Route OAuth configurato');
  } catch (error) {
    if (error.response?.status === 302) {
      console.log('✅ Route OAuth configurato');
    } else {
      console.log('❌ Route OAuth non funziona');
      console.log('   Controlla configurazione Google OAuth');
    }
  }

  console.log('\n🎉 Tutto sembra a posto!');
  console.log('📋 Prossimi passi:');
  console.log('   1. Vai su http://localhost:8080');
  console.log('   2. Clicca "Accedi con Google"');
  console.log('   3. Autorizza l\'app');
  console.log('   4. Inizia a usare il Knowledge Hub!');
}

debugStartup().catch(console.error);