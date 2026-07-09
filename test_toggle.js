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
    const data = await res.json();
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
  const itemId = items[0].id || items[0]._id;

  console.log(`Toggling item ${items[0].name} (Currently available: ${items[0].isAvailable})`);
  const toggle1 = await request(`/restaurants/menu/${itemId}/toggle`, 'PUT', {}, token);
  console.log('Toggle 1 result:', toggle1);

  if (toggle1.status === 200) {
    console.log('Toggling item again to reproduce bug...');
    const toggle2 = await request(`/restaurants/menu/${itemId}/toggle`, 'PUT', {}, token);
    console.log('Toggle 2 result:', toggle2);
  }
}

run();
