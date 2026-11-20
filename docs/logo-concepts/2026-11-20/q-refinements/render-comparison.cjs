// Concept presentation only. Generated source marks remain unchanged.
const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('/tmp/cloudq-readme-tools/node_modules/@resvg/resvg-js');
const dir = __dirname;
const variants = [
  {id:'a',file:'a-bold-original.png',title:'原形加粗',note:'保留对话尖角，图形最饱满',desc:'更接近选中的原版，继续保留对话的联想。'},
  {id:'b',file:'b-square-gateway.png',title:'方正厚重',note:'方正门框，收短出口',desc:'更像稳定的网关入口，结构感更强。'},
  {id:'c',file:'c-soft-compact.png',title:'圆润紧凑',note:'简化内部，圆润短尾',desc:'减少小尺寸细节，Q 的轮廓更直接。'},
];
const img = f => 'data:image/png;base64,' + fs.readFileSync(path.join(dir,f)).toString('base64');
const font = 'font-family="Avenir Next, Arial, Heiti SC, sans-serif"';
const text=(x,y,t,s=18,c='#121820',w=400,extra='')=>`<text x="${x}" y="${y}" ${font} font-size="${s}" fill="${c}" font-weight="${w}" ${extra}>${t}</text>`;
const mark=(id,x,y,size)=>`<use href="#${id}" transform="translate(${x} ${y}) scale(${size/1280})"/>`;
const line=(x1,y1,x2,y2)=>`<path d="M${x1} ${y1}H${x2}" stroke="#e1e5e9"/>`;
const defs=variants.map(v=>`<image id="${v.id}" width="1280" height="1280" href="${img(v.file)}"/>`).join('')+`<image id="original" width="1280" height="1280" href="${img('../a-q-portal.png')}"/>`;
const cols=variants.map((v,i)=>{
 const x=56+i*460, cx=x+204;
 let out=text(x,246,v.id.toUpperCase(),22,'#64748b',600)+text(x+37,246,v.title,24,'#151a21',600);
 out+=mark(v.id,cx-142,276,284);
 out+=text(cx,604,'CloudQ Gateway',32,'#121820',600,'text-anchor="middle" letter-spacing="-0.5"');
 out+=text(cx,643,v.note,17,'#52606e',400,'text-anchor="middle"');
 out+=line(x,678,x+408,678);
 const sizes=[16,24,32,48];
 sizes.forEach((size,j)=>{const center=x+45+j*103;out+=text(center,710,`${size} px`,13,'#7a8490',500,'text-anchor="middle"');out+=mark(v.id,center-size/2,752-size/2,size);});
 out+=`<rect x="${x}" y="804" width="408" height="84" rx="8" fill="#fff" stroke="#e1e5e9"/>`;
 out+=mark(v.id,x+20,829,32)+text(x+64,850,'CloudQ Gateway',20,'#121820',600)+text(x+388,853,'⌘',18,'#9aa2ad',400,'text-anchor="end"');
 out+=text(x,921,v.desc,16,'#52606e');
 return out;
}).join('');
const source=`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1080" viewBox="0 0 1440 1080"><title>CloudQ Gateway — 三版 Q 标志与小尺寸对比</title><defs>${defs}</defs><rect width="1440" height="1080" fill="#fff"/>${text(56,58,'CLOUDQ GATEWAY  /  LOGO STUDY 02',14,'#667585',600,'letter-spacing="1.7"')}${text(56,119,'同一个 Q，更饱满的轮廓。',42,'#111820',600)}${text(56,158,'保留 Q × 对话 × 网关的逻辑，比较笔画、转角和出口在小尺寸下的表现。',19,'#52606e')}${text(1384,58,'2026.11.20',14,'#7a8490',500,'text-anchor="end"')}${line(56,195,1384,195)}${cols}${line(56,962,1384,962)}${mark('original',56,989,32)}${text(103,1011,'原版 32 px',15,'#52606e',500)}${text(310,1011,'三个变体均为直接缩放；小图标效果请在预览页以 100% 比例查看。',16,'#52606e')}${text(56,1052,'方向草案 · 图形由图像工具生成，字标独立排版；尚未做最终矢量整理。',13,'#8993a0')}</svg>`;
const options={font:{loadSystemFonts:true,defaultFontFamily:'Avenir Next'},fitTo:{mode:'original'}};
const renderer=new Resvg(source,options);
fs.writeFileSync(path.join(dir,'comparison.svg'),renderer.toString());
fs.writeFileSync(path.join(dir,'comparison.png'),renderer.render().asPng());
const cards=variants.map(v=>`<section><header><span>${v.id.toUpperCase()}</span><h2>${v.title}</h2></header><img class="hero" src="${v.file}" alt="${v.title} Q 标志"><h3>CloudQ Gateway</h3><p>${v.note}</p><div class="sizes">${[16,24,32,48].map(s=>`<div><small>${s} px</small><div class="sample"><img width="${s}" height="${s}" src="${v.file}" alt="${s} 像素"></div></div>`).join('')}</div><div class="app-header"><img width="32" height="32" src="${v.file}" alt=""><strong>CloudQ Gateway</strong></div><p class="description">${v.desc}</p><a href="${v.file}" download>下载此版原图 ↗</a></section>`).join('');
fs.writeFileSync(path.join(dir,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CloudQ Gateway · Q 标志对比</title><style>*{box-sizing:border-box}body{margin:0;color:#121820;background:white;font-family:'Avenir Next','PingFang SC',Arial,sans-serif}main{max-width:1440px;padding:48px 48px 36px;margin:auto}.eyebrow{color:#657587;font-size:13px;letter-spacing:2px}h1{font-size:42px;font-weight:600;letter-spacing:-1px;margin:25px 0 14px}.intro{font-size:18px;color:#52606e;line-height:1.6}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:48px;border-top:1px solid #e1e5e9;margin-top:34px;padding-top:30px}section header{display:flex;gap:20px;align-items:baseline}section header span{color:#728194;font-size:19px}h2{font-size:24px;font-weight:600;margin:0}.hero{display:block;width:80%;max-width:284px;height:auto;margin:30px auto}h3{font-size:30px;letter-spacing:-.8px;text-align:center;font-weight:600;margin:20px 0 10px}p{text-align:center;color:#52606e}.sizes{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid #e1e5e9;margin-top:28px;padding-top:20px;text-align:center}small{font-size:13px;color:#7a8490}.sample{display:flex;align-items:center;justify-content:center;height:84px}.app-header{display:flex;align-items:center;gap:13px;padding:18px;border:1px solid #e1e5e9;border-radius:8px;margin-top:18px}.app-header strong{font-size:18px;font-weight:600}.description{text-align:left;font-size:14px;line-height:1.8}a{font-size:14px;color:#465f7f;text-underline-offset:4px}.baseline{display:flex;align-items:center;gap:16px;border-top:1px solid #e1e5e9;padding-top:25px;margin-top:40px;color:#52606e;font-size:14px}footer{font-size:13px;line-height:1.8;color:#8993a0;margin-top:20px}@media(max-width:900px){main{padding:28px 24px}h1{font-size:32px}.grid{grid-template-columns:1fr;gap:46px}.hero{width:260px}.baseline{align-items:flex-start;flex-wrap:wrap}}</style><main><div class="eyebrow">CLOUDQ GATEWAY / LOGO STUDY 02</div><h1>同一个 Q，更饱满的轮廓。</h1><div class="intro">保留 Q × 对话 × 网关的逻辑。下方图标按 16 / 24 / 32 / 48 CSS 像素显示，请以浏览器 100% 比例查看。</div><div class="grid">${cards}</div><div class="baseline"><img width="32" height="32" src="../a-q-portal.png" alt="原版32像素"><span>原版 32 px</span><span>三个变体直接使用生成原图缩放，未以另一张简化图替代。</span></div><footer>方向草案，待选定后进行最终矢量整理、像素对齐与深浅色导出。<br>图形由图像工具生成，CloudQ Gateway 字标独立排版；正式产品资源尚未替换。</footer></main></html>`);
console.log(JSON.stringify({board:path.join(dir,'comparison.png'),preview:path.join(dir,'index.html'),width:renderer.width,height:renderer.height}));
