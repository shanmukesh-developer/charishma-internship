const http = require('http');
const https = require('https');

const API_BASE = 'https://hostelbites-backend-jwmt.onrender.com/api';

async function request(endpoint, method = 'GET', body = null, token = null) {
  const url = `${API_BASE}${endpoint}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options = {
    method,
    headers
  };
  if (body) options.body = JSON.stringify(body);

  try {
    const res = await fetch(url, options);
    let data;
    try {
      data = await res.json();
    } catch {
      data = await res.text();
    }
    return { status: res.status, data };
  } catch (err) {
    return { status: 500, error: err.message };
  }
}

async function run() {
  console.log('Logging in as restaurant...');
  const login = await request('/restaurants/login', 'POST', { id: '8467dbf0-1b1b-4ae5-88b6-0fccbfcb1cbb', password: 'password123' });
  if (login.status !== 200) {
    console.error('Failed to login', login);
    return;
  }
  const token = login.data.token;
  
  console.log('Fetching menu...');
  const menuRes = await request(`/restaurants/${login.data.restaurant.id}/menu`, 'GET');
  const items = menuRes.data;
  if (items.length === 0) return;
  
  // Find an available item
  const item = items.find(i => i.isAvailable);
  if (!item) {
    console.log('No available items to test');
    return;
  }
  const itemId = item.id || item._id;

  console.log(`Disabling item ${item.name} with outOfStockUntil...`);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  
  const toggle1 = await request(`/restaurants/menu/${itemId}/toggle`, 'PUT', { outOfStockUntil: endOfDay.toISOString() }, token);
  console.log('Toggle 1 (Disable) result:', toggle1);

  if (toggle1.status === 200) {
    console.log('Re-enabling item to reproduce bug...');
    const toggle2 = await request(`/restaurants/menu/${itemId}/toggle`, 'PUT', {}, token);
    console.log('Toggle 2 (Re-enable) result:', toggle2);
  }
}

run();
