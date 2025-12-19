/**
 * Test script for verifying method and experiment saving functionality
 * Run with: node test-save.js
 */

const API_BASE = 'http://localhost:4000';

// Test user credentials
const TEST_USER = {
  name: 'Test Admin',
  email: 'testadmin@lab.local',
  password: 'testpassword123'
};

let userId = null;

async function registerOrLogin() {
  console.log('\n=== Setting up Test User ===');
  
  // Try to register first
  try {
    const registerRes = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TEST_USER)
    });
    
    if (registerRes.ok) {
      const user = await registerRes.json();
      console.log('✅ Registered new user:', user.name, '- Role:', user.role);
      userId = user.id;
      return true;
    } else if (registerRes.status === 409) {
      console.log('User already exists, logging in...');
    } else {
      const err = await registerRes.json();
      console.log('Registration response:', registerRes.status, err);
    }
  } catch (error) {
    console.log('Registration error:', error.message);
  }
  
  // Try to login
  try {
    const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password })
    });
    
    if (loginRes.ok) {
      const user = await loginRes.json();
      console.log('✅ Logged in as:', user.name, '- Role:', user.role);
      userId = user.id;
      return true;
    } else {
      const err = await loginRes.json();
      console.log('❌ Login failed:', err);
      return false;
    }
  } catch (error) {
    console.log('❌ Login error:', error.message);
    return false;
  }
}

async function testMethodSave() {
  console.log('\n=== Testing Method Save ===');
  
  const methodData = {
    title: 'Test Protocol - ' + new Date().toISOString(),
    category: 'molecular_biology',
    steps: { text: 'Step 1: Prepare samples\nStep 2: Run analysis\nStep 3: Record results' },
    isPublic: true
  };

  console.log('Sending method data:', JSON.stringify(methodData, null, 2));

  try {
    const response = await fetch(`${API_BASE}/methods`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId
      },
      body: JSON.stringify(methodData)
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Method saved successfully!');
      console.log('Response:', JSON.stringify(result, null, 2));
      return result;
    } else {
      console.log('❌ Method save failed!');
      console.log('Status:', response.status);
      console.log('Error:', JSON.stringify(result, null, 2));
      return null;
    }
  } catch (error) {
    console.log('❌ Network error:', error.message);
    return null;
  }
}

async function testExperimentSave() {
  console.log('\n=== Testing Experiment Save ===');
  
  const experimentData = {
    title: 'Test Experiment - ' + new Date().toISOString(),
    project: 'Test Project',
    modality: 'molecular_biology',
    observations: { text: 'Initial observations recorded at ' + new Date().toLocaleString() },
    tags: ['test', 'automated'],
    status: 'draft'
  };

  console.log('Sending experiment data:', JSON.stringify(experimentData, null, 2));

  try {
    const response = await fetch(`${API_BASE}/experiments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId
      },
      body: JSON.stringify(experimentData)
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Experiment saved successfully!');
      console.log('Response:', JSON.stringify(result, null, 2));
      return result;
    } else {
      console.log('❌ Experiment save failed!');
      console.log('Status:', response.status);
      console.log('Error:', JSON.stringify(result, null, 2));
      return null;
    }
  } catch (error) {
    console.log('❌ Network error:', error.message);
    return null;
  }
}

async function testGetMethods() {
  console.log('\n=== Testing Get Methods ===');
  
  try {
    const response = await fetch(`${API_BASE}/methods`, {
      headers: { 'x-user-id': userId }
    });
    
    const result = await response.json();
    console.log(`Found ${result.length} methods`);
    if (result.length > 0) {
      console.log('Latest method:', JSON.stringify(result[result.length - 1], null, 2));
    }
    return result;
  } catch (error) {
    console.log('❌ Error:', error.message);
    return [];
  }
}

async function testGetExperiments() {
  console.log('\n=== Testing Get Experiments ===');
  
  try {
    const response = await fetch(`${API_BASE}/experiments`, {
      headers: { 'x-user-id': userId }
    });
    
    const result = await response.json();
    console.log(`Found ${result.length} experiments`);
    if (result.length > 0) {
      console.log('Latest experiment:', JSON.stringify(result[result.length - 1], null, 2));
    }
    return result;
  } catch (error) {
    console.log('❌ Error:', error.message);
    return [];
  }
}

async function testGetProjects() {
  console.log('\n=== Testing Get Projects ===');
  
  try {
    const response = await fetch(`${API_BASE}/projects`, {
      headers: { 'x-user-id': userId }
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('Projects found:', result.length);
      console.log('Response:', JSON.stringify(result, null, 2));
    } else {
      console.log('Endpoint returned:', response.status);
    }
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
}

async function testAdminEndpoints() {
  console.log('\n=== Testing Admin Endpoints ===');
  
  try {
    const response = await fetch(`${API_BASE}/admin/experiments`, {
      headers: { 'x-user-id': userId }
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log(`✅ Admin can see ${result.length} experiments across all users`);
    } else {
      const err = await response.json();
      console.log('Admin endpoint response:', response.status, err);
    }
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
}

// Run all tests
async function runTests() {
  console.log('🧪 Electronic Lab Notebook - Save Tests');
  console.log('======================================');
  console.log('API Base:', API_BASE);
  
  // Setup user first
  const userSetup = await registerOrLogin();
  if (!userSetup) {
    console.log('\n❌ Cannot continue without valid user');
    return;
  }
  
  console.log('Using User ID:', userId);
  
  // Get initial counts
  const initialMethods = await testGetMethods();
  const initialExperiments = await testGetExperiments();
  
  // Test saving
  await testMethodSave();
  await testExperimentSave();
  
  // Get final counts
  const finalMethods = await testGetMethods();
  const finalExperiments = await testGetExperiments();
  
  // Test project organization
  await testGetProjects();
  
  // Test admin endpoints
  await testAdminEndpoints();
  
  console.log('\n======================================');
  console.log('Summary:');
  console.log(`  Methods: ${initialMethods.length} → ${finalMethods.length} (${finalMethods.length - initialMethods.length > 0 ? '+' : ''}${finalMethods.length - initialMethods.length})`);
  console.log(`  Experiments: ${initialExperiments.length} → ${finalExperiments.length} (${finalExperiments.length - initialExperiments.length > 0 ? '+' : ''}${finalExperiments.length - initialExperiments.length})`);
  console.log('Tests completed!');
}

runTests();
