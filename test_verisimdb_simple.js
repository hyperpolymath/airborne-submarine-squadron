// Simple test without imports to avoid path issues
const VERISIMDB_URL = 'http://localhost:8080';

console.log('🧪 Testing VerisimDB Connection...');
console.log();

// Test 1: Check if VerisimDB is running
async function testHealth() {
  try {
    const response = await fetch(`${VERISIMDB_URL}/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    
    if (response.ok) {
      console.log('✅ VerisimDB is running and healthy!');
      return true;
    } else {
      console.log('❌ VerisimDB returned error:', response.status);
      return false;
    }
  } catch (error) {
    console.log('❌ VerisimDB is not running');
    console.log('💡 Start it with:');
    console.log('   cd /var$REPOS_DIR/nextgen-databases/verisimdb');
    console.log('   deno run --allow-net --allow-read --allow-write --allow-env src/main.ts');
    return false;
  }
}

// Test 2: Try a simple query
async function testQuery() {
  try {
    const response = await fetch(`${VERISIMDB_URL}/query?type=game_state&limit=1`);
    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Query successful, found ${data.length} results`);
      return true;
    } else {
      console.log('⚠️  Query returned:', response.status);
      return false;
    }
  } catch (error) {
    console.log('❌ Query failed:', error.message);
    return false;
  }
}

// Run tests
const healthOk = await testHealth();
if (healthOk) {
  await testQuery();
}

console.log();
console.log('🎉 Test complete!');