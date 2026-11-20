// Present original generated color images without altering their pixels.
const fs = require('node:fs');
const path = require('node:path');
const {Resvg} = require('/tmp/cloudq-readme-tools/node_modules/@resvg/resvg-js');
const variants = [
  {
    "id": "b1",
    "file": "b1-blue-aqua.png",
    "title": "蓝色 × 浅青",
    "note": "完整蓝色 Q × 浅青对话气泡",
    "desc": "亮蓝与浅青相衬，清爽、醒目。",
    "colors": [
      "#2456DF",
      "#6DE2CF"
    ]
  },
  {
    "id": "b2",
    "file": "b2-navy-apricot.png",
    "title": "深蓝 × 杏橙",
    "note": "完整深蓝 Q × 杏橙对话气泡",
    "desc": "深色稳住外形，暖色突出回应。",
    "colors": [
      "#173B71",
      "#FFB17F"
    ]
  },
  {
    "id": "b3",
    "file": "b3-petrol-mint.png",
    "title": "墨青 × 薄荷",
    "note": "完整墨青 Q × 薄荷对话气泡",
    "desc": "同色系的深浅层次，更沉静、柔和。",
    "colors": [
      "#075D63",
      "#8BE0B5"
    ]
  }
];
const font='font-family="Avenir Next, Arial, Heiti SC, sans-serif"';
const tx=(x,y,t,s=18,c='#152031',w=400,e='')=>`<text x="${x}" y="${y}" ${font} font-size="${s}" fill="${c}" font-weight="${w}" ${e}>${t}</text>`;
const line=(x,y,x2)=>`<path d="M${x} ${y}H${x2}" stroke="#e1e5e9"/>`;
const data=f=>'data:image/png;base64,'+fs.readFileSync(path.join(__dirname,f)).toString('base64');
const mark=(id,x,y,size)=>`<use href="#${id}" transform="translate(${x} ${y}) scale(${size/1280})"/>`;
const defs=variants.map(v=>`<image id="${v.id}" width="1280" height="1280" href="${data(v.file)}"/>`).join('')+`<image id="mono" width="1280" height="1280" href="${data('../q-refinements/a-bold-original.png')}"/>`;
const cols=variants.map((v,i)=>{
 const x=56+i*460,cx=x+204;
 let s=tx(x,246,v.id.toUpperCase(),21,'#667585',600)+tx(x+47,246,v.title,24,'#152031',600);
 s+=mark(v.id,cx-142,276,284);
 s+=tx(cx,602,'CloudQ Gateway',32,'#172536',600,'text-anchor="middle" letter-spacing="-0.5"');
 s+=tx(cx,640,v.note,17,'#52606e',400,'text-anchor="middle"');
 const sw=28,gap=6,start=cx-(v.colors.length*sw+(v.colors.length-1)*gap)/2;
 v.colors.forEach((c,j)=>{s+=`<rect x="${start+j*(sw+gap)}" y="661" width="${sw}" height="8" rx="4" fill="${c}"/>`;});
 s+=line(x,699,x+408);
 [16,24,32,48].forEach((size,j)=>{const center=x+45+j*103;s+=tx(center,732,size+' px',13,'#7a8490',500,'text-anchor="middle"');s+=mark(v.id,center-size/2,775-size/2,size);});
 s+=`<rect x="${x}" y="824" width="408" height="84" rx="8" fill="#fff" stroke="#e1e5e9"/>`;
 s+=mark(v.id,x+20,849,32)+tx(x+64,870,'CloudQ Gateway',20,'#172536',600);
 s+=tx(x,943,v.desc,16,'#52606e');
 return s;
}).join('');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1100" viewBox="0 0 1440 1100"><title>CloudQ Gateway — A 方案内外双色与小图标</title><defs>${defs}</defs><rect width="1440" height="1100" fill="#fff"/>${tx(56,58,'CLOUDQ GATEWAY  /  COLOR STUDY 04',14,'#667585',600,'letter-spacing="1.7"')}${tx(56,119,'外层是 Q，内层是对话。',42,'#152031',600)}${tx(56,158,'沿用已选 A 方案，将完整外框与内侧气泡分别着色，保留连贯的轮廓。',19,'#52606e')}${tx(1384,58,'A 方案 · 内外双色',14,'#7a8490',500,'text-anchor="end"')}${line(56,195,1384)}${cols}${line(56,982,1384)}${mark('mono',56,1007,32)}${tx(103,1030,'已选 A · 单色基准',15,'#52606e',500)}${tx(360,1030,'16 / 24 / 32 / 48 px 使用同一图形直接缩放；预览页请以 100% 比例查看。',15,'#52606e')}${tx(56,1072,'内外双色方向稿 · 外层 Q 完整连贯，内侧气泡独立填色；定色后再做矢量整理。',13,'#8993a0')}</svg>`;
const r=new Resvg(svg,{font:{loadSystemFonts:true,defaultFontFamily:'Avenir Next'}});
fs.writeFileSync(path.join(__dirname,'comparison-inner-outer.svg'),r.toString());
fs.writeFileSync(path.join(__dirname,'comparison-inner-outer.png'),r.render().asPng());
const cards=variants.map(v=>`<section><header><span>${v.id.toUpperCase()}</span><h2>${v.title}</h2></header><img class="hero" src="${v.file}" alt="${v.title} Q 标志"><h3>CloudQ Gateway</h3><p>${v.note}</p><div class="swatches">${v.colors.map(c=>`<i style="background:${c}" title="目标色 ${c}"></i>`).join('')}</div><div class="sizes">${[16,24,32,48].map(s=>`<div><small>${s} px</small><div class="sample"><img width="${s}" height="${s}" src="${v.file}" alt="${s} 像素"></div></div>`).join('')}</div><div class="app-header"><img width="32" height="32" src="${v.file}" alt=""><strong>CloudQ Gateway</strong></div><p class="description">${v.desc}</p><a href="${v.file}" download>下载此版原图 ↗</a></section>`).join('');
fs.writeFileSync(path.join(__dirname,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CloudQ Gateway · A 方案内外双色</title><style>*{box-sizing:border-box}body{margin:0;color:#172536;background:white;font-family:'Avenir Next','PingFang SC',Arial,sans-serif}main{max-width:1440px;padding:48px 48px 36px;margin:auto}.eyebrow{color:#657587;font-size:13px;letter-spacing:2px}h1{font-size:42px;font-weight:600;letter-spacing:-1px;margin:25px 0 14px}.intro{font-size:18px;color:#52606e;line-height:1.6}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:48px;border-top:1px solid #e1e5e9;margin-top:34px;padding-top:30px}section header{display:flex;gap:20px;align-items:baseline}section header span{color:#728194;font-size:19px}h2{font-size:24px;font-weight:600;margin:0}.hero{display:block;width:80%;max-width:284px;height:auto;margin:30px auto}h3{font-size:30px;letter-spacing:-.8px;text-align:center;font-weight:600;margin:20px 0 10px}p{text-align:center;color:#52606e}.swatches{display:flex;gap:6px;justify-content:center;margin-top:18px}.swatches i{width:28px;height:8px;border-radius:4px}.sizes{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid #e1e5e9;margin-top:28px;padding-top:20px;text-align:center}small{font-size:13px;color:#7a8490}.sample{display:flex;align-items:center;justify-content:center;height:84px}.app-header{display:flex;align-items:center;gap:13px;padding:18px;border:1px solid #e1e5e9;border-radius:8px;margin-top:18px}.app-header strong{font-size:18px;font-weight:600}.description{text-align:left;font-size:14px;line-height:1.8}a{font-size:14px;color:#465f7f;text-underline-offset:4px}.baseline{display:flex;align-items:center;gap:16px;border-top:1px solid #e1e5e9;padding-top:25px;margin-top:40px;color:#52606e;font-size:14px}footer{font-size:13px;line-height:1.8;color:#8993a0;margin-top:20px}@media(max-width:900px){main{padding:28px 24px}h1{font-size:32px}.grid{grid-template-columns:1fr;gap:46px}.hero{width:260px}.baseline{align-items:flex-start;flex-wrap:wrap}}</style><main><div class="eyebrow">CLOUDQ GATEWAY / COLOR STUDY 04</div><h1>外层是 Q，内层是对话。</h1><div class="intro">外层 Q 与内侧对话气泡分别使用一种颜色。下方图标按 16 / 24 / 32 / 48 CSS 像素显示，请以浏览器 100% 比例查看。</div><div class="grid">${cards}</div><div class="baseline"><img width="32" height="32" src="../q-refinements/a-bold-original.png" alt="已选A单色版"><span>已选 A · 单色基准</span><a href="../q-refinements/index.html">查看上一轮轮廓对比 ↗</a></div><footer>内外双色方向稿。沿用已选 A 的造型，图像工具分别着色，字标独立排版；定色后再做最终矢量整理与小尺寸验证。</footer></main></html>`);
console.log(JSON.stringify({board:path.join(__dirname,'comparison-inner-outer.png'),preview:path.join(__dirname,'index.html')}));
