const fs = require('fs');

async function inspect() {
  const r = await fetch('https://upload.wikimedia.org/wikipedia/commons/3/32/Kfc_textlogo.svg');
  const t = await r.text();
  console.log(t.substring(0, 1000));
}

inspect().catch(console.error);
