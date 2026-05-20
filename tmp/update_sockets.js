const fs=require('fs');
const path=require('path');
function walk(dir){
  let res=[];
  if(!fs.existsSync(dir))return res;
  fs.readdirSync(dir).forEach(f=>{
    f=path.join(dir,f);
    if(fs.statSync(f).isDirectory())res=res.concat(walk(f));
    else if(f.endsWith('.tsx')||f.endsWith('.ts')||f.endsWith('.js'))res.push(f);
  });
  return res;
}
['admin-dashboard/src','delivery-app/src'].forEach(p=>{
  walk(path.join(__dirname, '..', p)).forEach(f=>{
    let c=fs.readFileSync(f,'utf8');
    let o=c; 
    c=c.replace(/transports:\s*\['websocket'\]/g, "transports: ['websocket', 'polling'], withCredentials: true"); 
    if(c!==o) fs.writeFileSync(f,c); 
  }); 
});
console.log("Done updating sockets");
