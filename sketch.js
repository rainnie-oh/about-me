/* ==== Merged & Fixed Version (apply user's latest requirements + unified click handler + dandelion reveal for mindsets) ==== */

// Glow effect variables
let glowX, glowY; // glow position
let glowSize = 120; // glow size
let glowOpacity = 0.6; // glow opacity

/* Tunables */
const PANEL_W = 240;
const GRAPH_OFFSET_X = 80;
const ROLE_RADIUS = 200;
const MINDSET_OUTER_R = ROLE_RADIUS + 120;
// 减小弹簧力度，让回弹更柔和
let TARGET_SPRING = 0.006;  // 原值0.010

// 增加阻尼，减少回弹次数
let DAMPING = 0.92;  // 原值0.95
const MAX_V = 2.8;

const MINDSET_REVEAL_MS = 1200;   // base reveal time (we'll randomize per-node to 1000-1500ms)
const MINDSET_DRIFT_AMP = 1.5;    // 减小漂移幅度
const MINDSET_DRIFT_SPEED = 0.12;  // 降低漂移速度使运动更柔和
const FADE_MS = 70;              // 50-80ms fade
const ALPHA_LERP_RATE = 0.45;    // how fast alpha approaches target per frame (tweak for ~FADE_MS)

/* Palette (hex strings retained for background use) */
let palette = {
  bg: "#1e1e1e",
  node: "#999999",
  nodeMuted: "rgba(153,153,153,0.25)",
  mindsetNode: "#666666", // 添加mindset节点的颜色
  label: "#dadada",
  edge: "rgba(170,170,170,0.35)",
  edgeMuted: "rgba(170,170,170,0.12)",
  panelBg: "rgba(42,42,42,0.85)",
  panelText: "#bababa",
  accent: "#8B6CEF"
};

/* Helpers: hex -> rgb */
function hexToRgb(hex) {
  if (!hex) return { r: 0, g: 0, b: 0 };
  const h = hex.replace("#", "");
  const bigint = parseInt(h, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255
  };
}
const ACCENT_RGB = hexToRgb(palette.accent);
const NODE_RGB = hexToRgb(palette.node);

/* State */
let NODES = [];
let LINKS = [];
let NODE_BY_ID = {};
let ROLE_TO_MINDSETS = {};

let hovered = null;
let listHoverId = null;
let active = null;         // selected node object
let expandedRoleId = null; // id string of expanded role
let grabbed = null;
let panel, treeBox, detailBox;
let ringAngle = 0;
let lastPanelClickTime = 0; // to suppress canvas click right after clicking panel

/* Data */
const DATA = {
  roles: {
    "UX/UI Designer": ["Empathy","Creativity","Data-driven","Storytelling","Quick prototype","Collaboration"],
    "Baker": ["Patience","Creativity","Iteration","Complexity"],
    "Musician": ["Aesthetics","Storytelling","Flow"],
    "Craftswoman": ["Playfulness","Creativity","Observation","Vibe coding","Prototype"]
  }
};

const ROLE_COPY = {
  "UX/UI Designer": "I explore and share new ways of working so that teams can co-create, gather perspectives, and design with insight at the core.",
  "Baker": "I once ran a 200-member home bakery. Back home, I became the pâtissière for my family, colleagues, and friends.",
  "Musician": "I play piano and drums, and sometimes whistle with perfect pitch.",
  "Craftswoman": "I capture fleeting sparks of inspiration through craft—where aesthetics and patience turn the invisible into form."
};

const NAME_COPY = "I believe design should make the complex simple, the simple profound, and the profound approachable.";

/* Node & Link classes with alpha transitions and renderPos for drift / reveal */
class Node {
  constructor(id,label,type,x,y,parentId=null,roleAngle=null){
    this.id=id; this.label=label; this.type=type;
    this.parentId = parentId;
    this.roleAngle = roleAngle;
    this.x=x; this.y=y;
    this.vx=0; this.vy=0;
    this.fx=0; this.fy=0;
    this.fixed=false;
    this.r=(type==="center")?8:(type==="role"?7:5);
    this.tx=x; this.ty=y;
    this.floatPhase = random(TWO_PI);
    this.floatAmp = random(0.8, MINDSET_DRIFT_AMP);
    this.floatSpeed = random(0.12, MINDSET_DRIFT_SPEED);
    this.revealUntil = 0;
    this.alpha = 255;           // current rendered alpha
    this.targetAlpha = 255;     // where alpha should lerp to

    // === 新增字段：跟踪“蒲公英” reveal 状态（修改点1） ===
    // 当 _revealDone === true 时，节点已回到 tx/ty 并保持静止（除非拖拽）
    this._revealDone = true;
  }
  isPointInside(mx,my){
    // use renderPos for hit-test so hovering follows visible position
    const pos = this.renderPos();
    const dx = (mx - pos.x) || 0;
    const dy = (my - pos.y) || 0;
    return dx*dx + dy*dy <= (this.r+6)*(this.r+6);
  }
  renderPos(){
    let rx = this.x, ry = this.y;
    const t = millis()/1000;

    // only apply float drift if reveal is done
    if(this.type === "mindset" && this._revealDone){
      // 修改ease-out效果：调整sin函数的处理方式
      const phase = t * this.floatSpeed + this.floatPhase;
      // 使用1 - pow(sin)让曲线呈现先快后慢
      const easeOutFactor = 1 - Math.pow(sin(phase), 2);
      rx += this.floatAmp * sin(phase) * easeOutFactor;
      ry += this.floatAmp * cos(phase) * easeOutFactor;
    } else if(this.type === "mindset" && !this._revealDone){
      // during reveal phase we suppressed float
    }

    // if reveal is active, lerp from current this.x/this.y -> tx/ty
    if(millis() < this.revealUntil){
      const rem = this.revealUntil - millis();
      const p = constrain(1 - rem / MINDSET_REVEAL_MS, 0, 1);
      rx = lerp(this.x, this.tx, easeOutCubic(p));
      ry = lerp(this.y, this.ty, easeOutCubic(p));
    } else {
      if(!this._revealDone && this.revealUntil > 0){
        this.x = this.tx;
        this.y = this.ty;
        this._revealDone = true;
        this.floatAmp = 0;
        this.revealUntil = 0;
      }
    }

    return {x: rx, y: ry};
  }
  // draw node using current alpha (which is interpolated each frame towards targetAlpha)
  drawNode(){
    if(this.alpha < 8) return;

    const pos = this.renderPos();
    const hl = (hovered === this) || (listHoverId === this.id) || (active && active.id === this.id);
    
    // 添加柔和的白色外发光效果
    if((hovered === this || listHoverId === this.id) && (this.type === "role" || this.type === "center")){
      drawingContext.shadowBlur = 15;
      drawingContext.shadowColor = "rgba(255, 255, 255, 0.3)";
    } else {
      drawingContext.shadowBlur = 0;
    }
    
    if(hl){
      fill(ACCENT_RGB.r, ACCENT_RGB.g, ACCENT_RGB.b, this.alpha);
    } else {
      if(this.type === "mindset") {
        const rgb = hexToRgb(palette.mindsetNode);
        fill(rgb.r, rgb.g, rgb.b, this.alpha);
      } else {
        fill(NODE_RGB.r, NODE_RGB.g, NODE_RGB.b, this.alpha);
      }
    }
    noStroke();
    circle(pos.x, pos.y, this.r * 2);
    
    // 重置阴影效果
    drawingContext.shadowBlur = 0;
  }
  drawLabel(){
    if(this.alpha < 8) return;
    
    // 当展开某个角色节点时：
    if(expandedRoleId) {
      // 1. 如果是mindset节点，只有当它属于被展开的角色时才显示标签
      if(this.type === "mindset" && this.parentId !== expandedRoleId) return;
      
      // 2. 如果是role节点，只有当它是被展开的角色时才显示标签
      if(this.type === "role" && this.id !== expandedRoleId) return;
      
      // 3. center节点在展开时不显示标签
      if(this.type === "center") return;
    } else {
      // 未展开任何角色时，mindset节点只在hover时显示标签
      if(this.type === "mindset" && !(hovered === this || listHoverId === this.id)) return;
    }
    
    const pos = this.renderPos();
    let col = palette.label;
    if(hovered === this || listHoverId === this.id) col = palette.accent;
    const rgb = hexToRgb(col);
    noStroke();
    fill(rgb.r, rgb.g, rgb.b, this.alpha);
    textFont("Red Hat Display, Inter, ui-sans-serif, system-ui");
    textSize(12);
    
    // 根据节点类型和位置调整标签位置
    if(this.type === "role" || this.type === "center") {
      // Baker和Musician的标签放在右下方
      if(this.label === "Baker" || this.label === "Musician" || this.type === "center") {
        textAlign(LEFT, TOP);
        text(this.label, pos.x + this.r + 6, pos.y + this.r + 6);
      } else {
        // 其他role节点保持原样
        textAlign(LEFT, CENTER);
        text(this.label, pos.x + this.r + 6, pos.y);
      }
    } else {
      // mindset节点标签保持原样
      textAlign(LEFT, CENTER);
      text(this.label, pos.x + this.r + 6, pos.y);
    }
  }
}

class Link {
  constructor(a,b){
    this.a = a; this.b = b;
    this.alpha = 255; this.targetAlpha = 255;
  }
  draw(){
    if(this.alpha < 6) return;
    const A = this.a.renderPos();
    const B = this.b.renderPos();
    stroke(170,170,170, this.alpha);
    strokeWeight(1.1);
    line(A.x, A.y, B.x, B.y);
  }
}

/* easing */
function easeOutCubic(t){ return 1 - pow(1 - t, 3); }

/* Setup + placement (keeps node ids stable across rebuild) */
function setup(){
  createCanvas(windowWidth, windowHeight);
  glowX = width/10;
  glowY = height/10;
  textFont("Red Hat Display, Inter, ui-sans-serif, system-ui"); // 设置全局字体
  buildLeftPanel();
  placeGraphNodes();
  rebuildTree();
  updateDetail(null);
}

/* Place nodes (center offset to the right to avoid panel overlap) */
function placeGraphNodes(){
  NODES = []; LINKS = []; NODE_BY_ID = {}; ROLE_TO_MINDSETS = {};
  const cx = (width / 2) + GRAPH_OFFSET_X;
  const cy = height / 2;

  // center node at origin
  const center = addNode(new Node("me","Rainnie","center",cx, cy));

  const roleNames = Object.keys(DATA.roles);
  const roleOrder = ["UX/UI Designer", "Baker", "Musician", "Craftswoman"]; // 统一顺序
  
  for(let i=0;i<roleOrder.length;i++){
    const role = roleOrder[i];
    let angle;
    // 设置每个角色的固定角度
    if(role === "UX/UI Designer") angle = -HALF_PI;  // 上
    else if(role === "Baker") angle = PI;       // 左
    else if(role === "Musician") angle = 0;     // 右
    else if(role === "Craftswoman") angle = HALF_PI;   // 下
    
    const tx = cx + ROLE_RADIUS * cos(angle);
    const ty = cy + ROLE_RADIUS * sin(angle);
    const roleNode = addNode(new Node("role_"+i, role, "role", cx + random(-6,6), cy + random(-6,6), null, angle));
    roleNode.tx = tx; roleNode.ty = ty;
    LINKS.push(new Link(center, roleNode));

    // compute mindset targets — mix inner/outside distribution so some sit between name & role
    const items = DATA.roles[role];
    const baseOpp = angle + PI;
    const wedgeDeg = 100;
    let angles = [];
    if(items.length === 1){
      angles = [baseOpp];
    } else {
      const step = radians(wedgeDeg)/(items.length - 1);
      const start = baseOpp - radians(wedgeDeg)/2;
      for(let j=0;j<items.length;j++) angles.push(start + j*step);
    }

    ROLE_TO_MINDSETS[roleNode.id] = [];
    for(let j=0;j<items.length;j++){
      const mLabel = items[j];
      // choose inner or outer radius (50% inner)
      const useInner = (random() < 0.5);
      const radial = useInner ? ROLE_RADIUS * 0.5 : MINDSET_OUTER_R * 1.1;
      const mx = cx + radial * cos(angles[j]);
      const my = cy + radial * sin(angles[j]);
      const mid = roleNode.id + "_m" + j;
      const mNode = addNode(new Node(mid, mLabel, "mindset", cx + random(-6,6), cy + random(-6,6), roleNode.id, angles[j]));
      mNode.tx = constrainToBounds(mx, my).x;
      mNode.ty = constrainToBounds(mx, my).y;
      // ensure reveal flag true at start (no auto reveal)
      mNode.revealUntil = 0;
      mNode._revealDone = true; // default: already revealed/idle
      LINKS.push(new Link(roleNode, mNode));
      ROLE_TO_MINDSETS[roleNode.id].push(mNode.id);
    }
  }

  // initialize alpha states
  updateAlphasImmediate();
}

function constrainToBounds(x,y){
  const margin = 36;
  const minX = PANEL_W + margin;
  const maxX = width - margin;
  const minY = margin;
  const maxY = height - margin;
  return { x: constrain(x, minX, maxX), y: constrain(y, minY, maxY) };
}

function addNode(n){
  NODES.push(n); NODE_BY_ID[n.id] = n; return n;
}

/* Left panel (About me) */
function buildLeftPanel(){
  if(panel) panel.remove();
  panel = createDiv();
  panel.position(20,20);
  panel.style("width", PANEL_W + "px");
  panel.style("background", "rgba(42,42,42,0.7)"); // lower opacity
  panel.style("backdrop-filter", "blur(10px)"); // add frosted glass effect
  panel.style("border-radius", "12px");
  panel.style("padding", "12px");
  panel.style("color", palette.panelText);
  panel.style("font-family", "Red Hat Display, Inter, sans-serif");
  panel.style("user-select", "none");
  panel.style("box-sizing", "border-box");

  const header = createElement("div", "About me");
  header.parent(panel);
  header.style("color", palette.accent);
  header.style("font-weight", "600");
  header.style("margin-bottom", "8px");

  treeBox = createDiv().parent(panel);
  treeBox.style("margin-bottom", "10px");

  detailBox = createDiv().parent(panel);
  detailBox.style("background", "rgba(255,255,255,0.02)");
  detailBox.style("padding", "12px");
  detailBox.style("border-radius", "8px");
}

let TREE_ELEMS = {};
function rebuildTree(){
  treeBox.html(""); TREE_ELEMS={};

  addTreeItem("me","Rainnie",0,true);
  const roleOrder = ["UX/UI Designer", "Baker", "Musician", "Craftswoman"]; // 按新顺序排列
  for(let i=0;i<roleOrder.length;i++){
    const role = roleOrder[i];
    addTreeItem("role_"+i, role, 1, true);
    
    const group = createDiv().parent(treeBox);
    group.id("group_role_" + i);
    group.style("display", "none");
    group.style("margin-left", "32px");
    group.style("position", "relative");
    
    const mids = ROLE_TO_MINDSETS["role_"+i] || [];
    mids.forEach((mid, index) => {
      if (index < 3) { // 只显示前三个节点
        const n = NODE_BY_ID[mid];
        const item = createDiv(n.label).parent(group);
        item.style("padding", "4px 6px");
        item.style("font-size", "13px");
        item.style("color", "rgba(255,255,255,0.55)");
        item.style("position", "relative"); // 为渐隐效果添加相对定位
        
        // // 如果是第三个节点且总节点数超过3个，添加渐隐效果
        // if (index === 2 && mids.length > 3) {
        //   const fadeOverlay = createDiv().parent(item);
        //   fadeOverlay.style("position", "absolute");
        //   fadeOverlay.style("left", "0");
        //   fadeOverlay.style("right", "0");
        //   fadeOverlay.style("top", "50%"); // 从节点中间开始渐隐
        //   fadeOverlay.style("bottom", "0");
        //   fadeOverlay.style("pointer-events", "none");
        //   fadeOverlay.style("background", "linear-gradient(to bottom, rgba(42,42,42,0.3) 0%, rgba(42,42,42,0.85) 100%)"); // 调整渐变透明度
        // }
        
        item.mouseOver(()=>{ listHoverId = mid; refreshTreeStyles(); });
        item.mouseOut(()=>{ if(listHoverId===mid) listHoverId=null; refreshTreeStyles(); });
      }
    });
  }
  refreshTreeStyles();
}

function addTreeItem(id,text,level=0,clickable=true){
  const row = createDiv(text).parent(treeBox);
  row.style("padding", "6px 8px 6px 24px"); // 增加左内边距，为指示器留出空间
  row.style("margin-left", (level * 16) + "px");
  row.style("cursor", clickable ? "pointer" : "default");
  row.style("border-radius", "6px");
  row.style("position", "relative");
  
  if (level > 0) {
    // 竖线
    const vLine = createDiv("");
    vLine.parent(row);
    vLine.style("position", "absolute");
    vLine.style("left", (level * 16 - 12) + "px");
    vLine.style("top", "0");
    vLine.style("width", "1px");
    vLine.style("height", "100%");
    vLine.style("background", "rgba(255,255,255,0.12)");
    
    // 横线，调整位置避免与文本重叠
    const hLine = createDiv("");
    hLine.parent(row);
    hLine.style("position", "absolute");
    hLine.style("left", (level * 16 - 12) + "px");
    hLine.style("top", "50%");
    hLine.style("width", "16px"); // 增加横线长度
    hLine.style("height", "1px");
    hLine.style("background", "rgba(255,255,255,0.12)");
  }

  row.mouseOver(()=>{ listHoverId = id; refreshTreeStyles(); });
  row.mouseOut(()=>{ if(listHoverId===id) listHoverId=null; refreshTreeStyles(); });

  if(clickable){
    row.mousePressed(()=>{
      // suppress next canvas click so clicking the panel doesn't immediately clear selection
      lastPanelClickTime = millis();
      const node = NODE_BY_ID[id];
      if(!node) return;
      // 使用统一的 setActiveNode 处理点击逻辑
      setActiveNode(node);
    });
  }
  TREE_ELEMS[id] = row;
  return row;
}

function refreshTreeStyles(){
  Object.keys(ROLE_TO_MINDSETS).forEach(roleId => {
    const idx = roleId.split("_")[1];
    const g = select("#group_role_" + idx);
    if(g) g.style("display", expandedRoleId === roleId ? "block" : "none");
  });

  Object.keys(TREE_ELEMS).forEach(id=>{
    const el = TREE_ELEMS[id];
    const isActive = active && active.id === id;
    const isHover = listHoverId === id;
    el.style("background", isActive ? "rgba(139,108,239,0.12)" : (isHover ? "rgba(255,255,255,0.04)" : "transparent"));
    el.style("color", isActive ? palette.accent : palette.panelText);
  });
}

/* Unified active node handler */
function setActiveNode(node){
  if(!node) return;
  // preserve previous behavior:
  // - center: select center, collapse expansion
  // - role: select role and expand it (using setExpandedRole which also sets reveal etc.)
  // - mindset: highlight only (no change to expansion beyond original behavior)
  active = node;
  if(node.type === "center"){
    expandedRoleId = null;
    updateDetail(node);
  } else if(node.type === "role"){
    // setExpandedRole will update expandedRoleId, reveal mindsets and refresh styles
    setExpandedRole(node.id);
    updateDetail(node);
    // setExpandedRole already calls updateAlphasImmediate() and refreshTreeStyles()
    // but we still call updateAlphasImmediate below to keep behavior consistent
  } else if(node.type === "mindset"){
    // mindset click: keep existing behavior — highlight mindset but do not change current expandedRoleId
    updateDetail(null);
  }
  refreshTreeStyles();
  updateAlphasImmediate();
}

function updateDetail(node){
  detailBox.html("");
  if(!node){
    const p = createDiv("Click a role to view details."); p.parent(detailBox); p.style("color", palette.panelText);
    return;
  }
  
  const body = createDiv().parent(detailBox);
  body.style("color", palette.panelText); body.style("font-size","13px"); body.style("line-height","1.5");
  if(node.type === "center"){
    body.html(NAME_COPY);
  } else if(node.type === "role"){
    body.html(ROLE_COPY[node.label] || "");
    const imageRow = createDiv().parent(detailBox);
    imageRow.style("display","flex"); 
    imageRow.style("gap","14px"); 
    imageRow.style("margin-top","14px");
    
    // 创建图片容器
    const createImageContainer = (imagePath) => {
      const container = createDiv().parent(imageRow);
      container.style("flex","1");
      container.style("aspect-ratio", "16/9"); // 设置固定的宽高比
      container.style("border-radius","8px");
      container.style("overflow","hidden");
      container.style("background","#444");
      container.style("position", "relative"); // 为绝对定位的图片添加相对定位容器
      
      // 添加图片
      const img = createImg(imagePath, "");
      img.parent(container);
      img.style("position", "absolute"); // 使用绝对定位
      img.style("width","100%");
      img.style("height","100%");
      img.style("object-fit","cover"); // 保持比例填充
      img.style("object-position","center"); // 居中裁切
      return container;
    };
    
    // 使用Role node名称创建图片路径
    createImageContainer(`images/${node.label}-1.jpg`);
    createImageContainer(`images/${node.label}-2.jpg`);
    
  
  }
}

/* set expanded role: reveal mindset nodes gently and update targets */
function setExpandedRole(roleId){
  expandedRoleId = roleId;

  // set targetAlpha for nodes & links (smoothly interpolated in draw loop)
  updateAlphasImmediate();

  // set revealUntil for mindsets in this role
  const now = millis();
  (ROLE_TO_MINDSETS[roleId] || []).forEach(mid => {
    const m = NODE_BY_ID[mid];

    // === 修改点2：为蒲公英效果设置起始偏移并随机时长（1 - 1.5s），角度偏移限制 ±90°，半径 40-120px ===
    // 计算以默认 tx/ty 为目标的起始偏移位置（被“风吹开”的位置）
    const maxAngleOffset = PI / 2; // ±90度，保证相邻不会超过 180°
    const delta = random(-maxAngleOffset, maxAngleOffset);
    // 基于角色角度加上随机偏移
    const startAngle = (m.roleAngle || 0) + delta;
    const startRadius = random(40, 120); // 起始偏移距离，可调范围
    const startX = m.tx + cos(startAngle) * startRadius;
    const startY = m.ty + sin(startAngle) * startRadius;

    // 把节点当前位置设置为起始偏移（这样 renderPos 会从这里 lerp 到 tx/ty）
    m.x = startX;
    m.y = startY;

    // 将 revealUntil 设为一个随机 1000-1500 ms（1 - 1.5s），并标记为未完成
    const dur = random(1000, 1500);
    m.revealUntil = now + dur;
    m._revealDone = false;

    // 在动画期间暂时关闭 float（这样不会出现僵硬抖动），动画结束后我们会把 floatAmp 保持为 0（从而静止）
    m.floatAmp = 0;
    // （保持 m.tx/m.ty 不变，renderPos 会负责 ease-out lerp 回位）

    // 注：我们没有修改 m.tx/m.ty（默认目标），只是更改起始 this.x/this.y 与 revealUntil 时长
  });
  refreshTreeStyles();
}

/* UI interaction handlers */
function mousePressed(){
  // Canvas drag start detection — only for nodes (we'll hit test against renderPos)
  grabbed = getNodeUnderMouse();
  if(grabbed){ grabbed.fixed = true; grabbed.vx = 0; grabbed.vy = 0; }
}
function mouseDragged(){
  if(grabbed){
    // 计算节点移动的偏移量
    const dx = mouseX - grabbed.x;
    const dy = mouseY - grabbed.y;
    
    // 更新被拖拽节点的位置
    grabbed.x = constrain(mouseX, PANEL_W + 20, width - 20);
    grabbed.y = constrain(mouseY, 20, height - 20);
    
    // 如果拖拽的是role节点且该节点是当前激活的节点，才移动其mindset节点
    if(grabbed.type === "role" && active && active.id === grabbed.id) {
      const mids = ROLE_TO_MINDSETS[grabbed.id] || [];
      mids.forEach(mid => {
        const m = NODE_BY_ID[mid];
        if(m) {
          m.x = constrain(m.x + dx, PANEL_W + 20, width - 20);
          m.y = constrain(m.y + dy, 20, height - 20);
        }
      });
    }
  }
}
function mouseReleased(){
  if(grabbed){
    grabbed.fixed = false;
    grabbed = null;
  }
}
function mouseClicked(){
  // If we just clicked a panel item, ignore this canvas click (prevents immediate deselect)
  if(millis() - lastPanelClickTime < 300) return;

  const n = getNodeUnderMouse();
  if(!n){
    // clicking empty area resets selection — but do it with fade animation (targetAlpha updated)
    active = null; expandedRoleId = null; updateDetail(null); refreshTreeStyles();
    updateAlphasImmediate(); // set new targets
    return;
  }
  // delegate to unified handler (preserves original behaviors)
  setActiveNode(n);
}

function getNodeUnderMouse(){
  // hit-test rendered positions and only on visible nodes (matching current expandedRoleId rules)
  for(let i = NODES.length - 1; i >= 0; i--){
    const n = NODES[i];
    // visibility quick check
    if(!isNodeVisible(n)) continue;
    if(n.isPointInside(mouseX, mouseY)) return n;
  }
  return null;
}

function isNodeVisible(n){
  if(expandedRoleId){
    if(n.type === "center") return (n.id === expandedRoleId) ? true : false; // center hidden while role expanded
    if(n.type === "role") return n.id === expandedRoleId;
    if(n.type === "mindset") return n.parentId === expandedRoleId;
    return false;
  } else {
    return n.type !== "mindset"; // default: show center + roles only
  }
}

/* draw loop */
function draw(){
  background(palette.bg);
  
  // Draw glow effect
  drawingContext.save();
  drawingContext.filter = 'blur(50px)';
  noStroke();
  fill(ACCENT_RGB.r, ACCENT_RGB.g, ACCENT_RGB.b, glowOpacity * 255);
  circle(glowX, glowY, glowSize);
  drawingContext.restore();
  
  // Update glow position (follow mouse)
  glowX = lerp(glowX, mouseX, 0.05);
  glowY = lerp(glowY, mouseY, 0.05);
  drawCoordinateSystem(); // Add coordinate system

  // physics step
  simulate();

  // Update alpha targets per expandedRoleId and animate alpha toward targets
  updateAlphas();

  // draw links first (they will use their alpha)
  for(const L of LINKS) L.draw();

  // hovered detection (use renderPos)
  hovered = null;
  for(const n of NODES){
    if(!isNodeVisible(n)) continue;
    if(n.isPointInside(mouseX, mouseY)){ hovered = n; break; }
  }

  // nodes
  for(const n of NODES) n.drawNode();
  for(const n of NODES) n.drawLabel();

  // name highlight ring when center selected
  if(active && active.type === "center"){
    drawHighlightRing(active);
  }

  // DOM tree update
  refreshTreeStyles();
}

/* update alpha targets for nodes and links and animate them */
function updateAlphasImmediate(){
  // set desired targets (immediate) then updateAlphas() will lerp
  NODES.forEach(n => {
    if(expandedRoleId){
      // when a role is expanded: non-related nodes become translucent (10-20%), related full
      if(n.type === "role"){
        n.targetAlpha = (n.id === expandedRoleId) ? 255 : 40;
      } else if(n.type === "mindset"){
        n.targetAlpha = (n.parentId === expandedRoleId) ? 255 : 40;
      } else if(n.type === "center"){
        n.targetAlpha = 40; // center also faded per requirement
      }
    } else {
      // default: center + roles visible, mindsets show nodes only (no labels)
      if(n.type === "mindset"){
        n.targetAlpha = 255;  // 让节点可见
      } else {
        n.targetAlpha = 255;
      }
    }
  });

  LINKS.forEach(l => {
    if(expandedRoleId){
      // 当展开角色节点时，隐藏所有连接线，除了选中角色与其特质节点之间的连接
      const isRoleToMindsetLink = l.a.id === expandedRoleId || l.b.id === expandedRoleId;
      l.targetAlpha = isRoleToMindsetLink ? 255 : 0;
    } else {
      // default: only center<->role links shown
      if((l.a.type === "center" && l.b.type === "role") || 
         (l.b.type === "center" && l.a.type === "role")){
        l.targetAlpha = 255;
      } else {
        l.targetAlpha = 0;
      }
    }
  });
}

/* called per frame to smoothly approach targetAlpha */
function updateAlphas(){
  // alpha lerp factor tuned to approximate FADE_MS
  const factor = ALPHA_LERP_RATE;
  NODES.forEach(n => {
    n.alpha = lerp(n.alpha, n.targetAlpha, factor);
  });
  LINKS.forEach(l => {
    l.alpha = lerp(l.alpha, l.targetAlpha, factor);
  });
}

/* physics: gentle springs, repulsion, mindsets radial constraint + prevent off canvas */
function simulate(){
  // reset forces
  for(const n of NODES){ n.fx = 0; n.fy = 0; }

  // target spring
  for(const n of NODES){
    // use tx/ty to pull nodes home gently
    const dx = (n.tx || n.x) - n.x;
    const dy = (n.ty || n.y) - n.y;
    n.fx += dx * TARGET_SPRING;
    n.fy += dy * TARGET_SPRING;
  }

  // soft repulsion among visible nodes to avoid overlap
  const kr = 120;
  const minSep = 28;
  for(let i=0;i<NODES.length;i++){
    for(let j=i+1;j<NODES.length;j++){
      const a = NODES[i], b = NODES[j];
      // prefer repulsion only among nodes that are currently visible or soon-to-be visible
      if(!isNodePotentiallyVisible(a) && !isNodePotentiallyVisible(b)) continue;
      let dx = b.x - a.x, dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      d = Math.max(0.001, d);
      if(d < minSep*2){
        const f = kr / (d*d);
        const nx = dx / d, ny = dy / d;
        a.fx -= f * nx; a.fy -= f * ny;
        b.fx += f * nx; b.fy += f * ny;
      }
    }
  }

  // ensure mindsets stay in/out relative to center: soft constraint (push outward if too close)
  const center = NODE_BY_ID["me"];
  for(const roleId in ROLE_TO_MINDSETS){
    const roleNode = NODE_BY_ID[roleId];
    const rc = dist(center.x, center.y, roleNode.tx, roleNode.ty);
    (ROLE_TO_MINDSETS[roleId]||[]).forEach(mid=>{
      const m = NODE_BY_ID[mid];
      const dm = dist(center.x, center.y, m.x, m.y);
      const minR = rc * 0.72; // allow some inside placement but not too close
      if(dm < minR){
        // gentle outward push toward m.tx,m.ty
        m.fx += (m.tx - m.x) * 0.05;
        m.fy += (m.ty - m.y) * 0.05;
      }
      // also clamp tx/ty to be on canvas so they don't go off-screen
      const constrained = constrainToBounds(m.tx, m.ty);
      m.tx = constrained.x; m.ty = constrained.y;
    });
  }

  // integrate with damping and v clamp
  for(const n of NODES){
    if(n.fixed) continue;
    n.vx = (n.vx + n.fx) * DAMPING;
    n.vy = (n.vy + n.fy) * DAMPING;
    n.vx = constrain(n.vx, -MAX_V, MAX_V);
    n.vy = constrain(n.vy, -MAX_V, MAX_V);
    n.x += n.vx;
    n.y += n.vy;
  }
}

/* utility: nodes that might be visible in next state (for repulsion optim) */
function isNodePotentiallyVisible(n){
  if(expandedRoleId) {
    if(n.type === "center") return true;
    if(n.type === "role") return n.id === expandedRoleId;
    if(n.type === "mindset") return n.parentId === expandedRoleId;
    return false;
  } else {
    return n.type !== "mindset";
  }
}

/* highlight ring — compute radius so it passes through role centers; slower rotation */
function drawHighlightRing(center){
  // compute average radius to role centers
  const roleNodes = Object.keys(ROLE_TO_MINDSETS).map(id => NODE_BY_ID[id]);
  if(roleNodes.length === 0) return;
  let sumR = 0;
  roleNodes.forEach(rn => sumR += dist(center.x, center.y, rn.tx, rn.ty));
  const ringR = sumR / roleNodes.length;
  ringAngle += 0.006; // slower rotation
  push();
  translate(center.x, center.y);
  rotate(ringAngle);
  noFill();
  stroke(ACCENT_RGB.r, ACCENT_RGB.g, ACCENT_RGB.b, 200);
  drawingContext.setLineDash([6,6]);
  strokeWeight(1.2);
  ellipse(0,0, ringR*2, ringR*2);
  // draw little dots at role angles
  const roleNames = Object.keys(DATA.roles);
  for(let i=0;i<roleNames.length;i++){
    const a = -HALF_PI + i*(TWO_PI/roleNames.length);
    const rx = ringR * cos(a);
    const ry = ringR * sin(a);
    noStroke(); fill(ACCENT_RGB.r, ACCENT_RGB.g, ACCENT_RGB.b, 220);
    circle(rx, ry, 6);
  }
  drawingContext.setLineDash([]);
  pop();
}

function drawCoordinateSystem(){
  // 移除PANEL_W/6的偏移，使坐标系原点与中心节点重合
  const cx = (width / 2) + GRAPH_OFFSET_X;
  const cy = height / 2;
  const padding = 48;
  const axisLength = width - padding * 2;
  
  // 设置虚线样式
  stroke(170, 170, 170, 100); // 浅灰色半透明
  strokeWeight(1);
  drawingContext.setLineDash([5, 5]); // 设置虚线样式
  
  // 绘制X轴
  line(padding, cy, width - padding, cy);
  // 绘制Y轴
  line(cx, padding, cx, height - padding);
  
  // 重置虚线样式
  drawingContext.setLineDash([]);
  
  // 添加轴标签
  noStroke();
  fill(170, 170, 170, 100);
  textFont("Red Hat Display, Inter, ui-sans-serif, system-ui"); // 添加这行设置字体
  textSize(12);
  
  // X轴标签
  textAlign(CENTER, TOP);
  text("Physical", padding + 30, cy + 16);
  text("Digital", width - padding - 30, cy + 16);
  
  // Y轴标签，调整位置
  textAlign(RIGHT, BOTTOM); // 修改对齐方式
  text("Shared\nExperience", cx - 16, padding - 2); // 向上移动2px
  
  textAlign(RIGHT, TOP);
  text("Self\nExpression", cx - 16, height - padding + 2); // 向下移动2px
}

/* Window resize: rebuild positions but preserve identity */
function windowResized(){
  resizeCanvas(windowWidth, windowHeight);
  // rebuild nodes to recenter relative to panel width
  placeGraphNodes();
  rebuildTree();
  updateDetail(active ? active : null);
}

/* helpers */
function constrain(v, a, b){ return Math.max(a, Math.min(b, v)); }

/* ========== INITIALIZE ALPHAS ========== */
/* call after placeGraphNodes or whenever expandedRoleId changes */
updateAlphasImmediate(); // set initial targets
updateAlphas();          // immediate smoothing start

// 添加绘制坐标系的函数
function drawCoordinateSystem(){
  // 移除PANEL_W/6的偏移，使坐标系原点与中心节点重合
  const cx = (width / 2) + GRAPH_OFFSET_X;
  const cy = height / 2;
  const padding = 48;
  const axisLength = width - padding * 2;
  
  // 设置虚线样式
  stroke(170, 170, 170, 100); // 浅灰色半透明
  strokeWeight(1);
  drawingContext.setLineDash([5, 5]); // 设置虚线样式
  
  // 绘制X轴
  line(padding, cy, width - padding, cy);
  // 绘制Y轴
  line(cx, padding, cx, height - padding);
  
  // 重置虚线样式
  drawingContext.setLineDash([]);
  
  // 添加轴标签
  noStroke();
  fill(170, 170, 170, 100);
  textSize(12);
  
  // X轴标签
  textAlign(CENTER, TOP);
  text("Physical", padding + 30, cy + 16);
  text("Digital", width - padding - 30, cy + 16);
  
  // Y轴标签，调整位置
  textAlign(RIGHT, BOTTOM); // 修改对齐方式
  text("Shared\nExperience", cx - 16, padding - 2); // 向上移动2px
  
  textAlign(RIGHT, TOP);
  text("Self\nExpression", cx - 16, height - padding + 2); // 向下移动2px
}

// 在draw函数中调用（需要在绘制节点之前）：
function draw(){
  background(palette.bg);
  
  // Draw glow effect
  drawingContext.save();
  drawingContext.filter = 'blur(50px)';
  noStroke();
  fill(ACCENT_RGB.r, ACCENT_RGB.g, ACCENT_RGB.b, glowOpacity * 255);
  circle(glowX, glowY, glowSize);
  drawingContext.restore();
  
  // Update glow position (follow mouse)
  glowX = lerp(glowX, mouseX, 0.05);
  glowY = lerp(glowY, mouseY, 0.05);
  drawCoordinateSystem(); // 添加这一行

  // physics step
  simulate();

  // Update alpha targets per expandedRoleId and animate alpha toward targets
  updateAlphas();

  // draw links first (they will use their alpha)
  for(const L of LINKS) L.draw();

  // hovered detection (use renderPos)
  hovered = null;
  for(const n of NODES){
    if(!isNodeVisible(n)) continue;
    if(n.isPointInside(mouseX, mouseY)){ hovered = n; break; }
  }

  // nodes
  for(const n of NODES) n.drawNode();
  for(const n of NODES) n.drawLabel();

  // name highlight ring when center selected
  if(active && active.type === "center"){
    drawHighlightRing(active);
  }

  // DOM tree update
  refreshTreeStyles();
}

/* update alpha targets for nodes and links and animate them */
function updateAlphasImmediate(){
  // set desired targets (immediate) then updateAlphas() will lerp
  NODES.forEach(n => {
    if(expandedRoleId){
      // when a role is expanded: non-related nodes become translucent (10-20%), related full
      if(n.type === "role"){
        n.targetAlpha = (n.id === expandedRoleId) ? 255 : 40;
      } else if(n.type === "mindset"){
        n.targetAlpha = (n.parentId === expandedRoleId) ? 255 : 40;
      } else if(n.type === "center"){
        n.targetAlpha = 40; // center also faded per requirement
      }
    } else {
      // default: center + roles visible, mindsets show nodes only (no labels)
      if(n.type === "mindset"){
        n.targetAlpha = 255;  // 让节点可见
      } else {
        n.targetAlpha = 255;
      }
    }
  });

  LINKS.forEach(l => {
    if(expandedRoleId){
      // 当展开角色节点时，隐藏所有连接线，除了选中角色与其特质节点之间的连接
      const isRoleToMindsetLink = l.a.id === expandedRoleId || l.b.id === expandedRoleId;
      l.targetAlpha = isRoleToMindsetLink ? 255 : 0;
    } else {
      // default: only center<->role links shown
      if((l.a.type === "center" && l.b.type === "role") || 
         (l.b.type === "center" && l.a.type === "role")){
        l.targetAlpha = 255;
      } else {
        l.targetAlpha = 0;
      }
    }
  });
}

/* called per frame to smoothly approach targetAlpha */
function updateAlphas(){
  // alpha lerp factor tuned to approximate FADE_MS
  const factor = ALPHA_LERP_RATE;
  NODES.forEach(n => {
    n.alpha = lerp(n.alpha, n.targetAlpha, factor);
  });
  LINKS.forEach(l => {
    l.alpha = lerp(l.alpha, l.targetAlpha, factor);
  });
}

/* physics: gentle springs, repulsion, mindsets radial constraint + prevent off canvas */
function simulate(){
  // reset forces
  for(const n of NODES){ n.fx = 0; n.fy = 0; }

  // target spring
  for(const n of NODES){
    // use tx/ty to pull nodes home gently
    const dx = (n.tx || n.x) - n.x;
    const dy = (n.ty || n.y) - n.y;
    n.fx += dx * TARGET_SPRING;
    n.fy += dy * TARGET_SPRING;
  }

  // soft repulsion among visible nodes to avoid overlap
  const kr = 120;
  const minSep = 28;
  for(let i=0;i<NODES.length;i++){
    for(let j=i+1;j<NODES.length;j++){
      const a = NODES[i], b = NODES[j];
      // prefer repulsion only among nodes that are currently visible or soon-to-be visible
      if(!isNodePotentiallyVisible(a) && !isNodePotentiallyVisible(b)) continue;
      let dx = b.x - a.x, dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      d = Math.max(0.001, d);
      if(d < minSep*2){
        const f = kr / (d*d);
        const nx = dx / d, ny = dy / d;
        a.fx -= f * nx; a.fy -= f * ny;
        b.fx += f * nx; b.fy += f * ny;
      }
    }
  }

  // ensure mindsets stay in/out relative to center: soft constraint (push outward if too close)
  const center = NODE_BY_ID["me"];
  for(const roleId in ROLE_TO_MINDSETS){
    const roleNode = NODE_BY_ID[roleId];
    const rc = dist(center.x, center.y, roleNode.tx, roleNode.ty);
    (ROLE_TO_MINDSETS[roleId]||[]).forEach(mid=>{
      const m = NODE_BY_ID[mid];
      const dm = dist(center.x, center.y, m.x, m.y);
      const minR = rc * 0.72; // allow some inside placement but not too close
      if(dm < minR){
        // gentle outward push toward m.tx,m.ty
        m.fx += (m.tx - m.x) * 0.05;
        m.fy += (m.ty - m.y) * 0.05;
      }
      // also clamp tx/ty to be on canvas so they don't go off-screen
      const constrained = constrainToBounds(m.tx, m.ty);
      m.tx = constrained.x; m.ty = constrained.y;
    });
  }

  // integrate with damping and v clamp
  for(const n of NODES){
    if(n.fixed) continue;
    n.vx = (n.vx + n.fx) * DAMPING;
    n.vy = (n.vy + n.fy) * DAMPING;
    n.vx = constrain(n.vx, -MAX_V, MAX_V);
    n.vy = constrain(n.vy, -MAX_V, MAX_V);
    n.x += n.vx;
    n.y += n.vy;
  }
}

/* utility: nodes that might be visible in next state (for repulsion optim) */
function isNodePotentiallyVisible(n){
  if(expandedRoleId) {
    if(n.type === "center") return true;
    if(n.type === "role") return n.id === expandedRoleId;
    if(n.type === "mindset") return n.parentId === expandedRoleId;
    return false;
  } else {
    return n.type !== "mindset";
  }
}

/* highlight ring — compute radius so it passes through role centers; slower rotation */
function drawHighlightRing(center){
  // compute average radius to role centers
  const roleNodes = Object.keys(ROLE_TO_MINDSETS).map(id => NODE_BY_ID[id]);
  if(roleNodes.length === 0) return;
  let sumR = 0;
  roleNodes.forEach(rn => sumR += dist(center.x, center.y, rn.tx, rn.ty));
  const ringR = sumR / roleNodes.length;
  ringAngle += 0.006; // slower rotation
  push();
  translate(center.x, center.y);
  rotate(ringAngle);
  noFill();
  stroke(ACCENT_RGB.r, ACCENT_RGB.g, ACCENT_RGB.b, 200);
  drawingContext.setLineDash([6,6]);
  strokeWeight(1.2);
  ellipse(0,0, ringR*2, ringR*2);
  // draw little dots at role angles
  const roleNames = Object.keys(DATA.roles);
  for(let i=0;i<roleNames.length;i++){
    const a = -HALF_PI + i*(TWO_PI/roleNames.length);
    const rx = ringR * cos(a);
    const ry = ringR * sin(a);
    noStroke(); fill(ACCENT_RGB.r, ACCENT_RGB.g, ACCENT_RGB.b, 220);
    circle(rx, ry, 6);
  }
  drawingContext.setLineDash([]);
  pop();
}

function drawCoordinateSystem(){
  // 移除PANEL_W/6的偏移，使坐标系原点与中心节点重合
  const cx = (width / 2) + GRAPH_OFFSET_X;
  const cy = height / 2;
  const padding = 48;
  const axisLength = width - padding * 2;
  
  // 设置虚线样式
  stroke(170, 170, 170, 100); // 浅灰色半透明
  strokeWeight(1);
  drawingContext.setLineDash([5, 5]); // 设置虚线样式
  
  // 绘制X轴
  line(padding, cy, width - padding, cy);
  // 绘制Y轴
  line(cx, padding, cx, height - padding);
  
  // 重置虚线样式
  drawingContext.setLineDash([]);
  
  // 添加轴标签
  noStroke();
  fill(170, 170, 170, 100);
  textFont("Red Hat Display, Inter, ui-sans-serif, system-ui"); // 添加这行设置字体
  textSize(12);
  
  // X轴标签
  textAlign(CENTER, TOP);
  text("Physical", padding + 30, cy + 16);
  text("Digital", width - padding - 30, cy + 16);
  
  // Y轴标签，调整位置
  textAlign(RIGHT, BOTTOM); // 修改对齐方式
  text("Shared\nExperience", cx - 16, padding - 2); // 向上移动2px
  
  textAlign(RIGHT, TOP);
  text("Self\nExpression", cx - 16, height - padding + 2); // 向下移动2px
}

/* Window resize: rebuild positions but preserve identity */
function windowResized(){
  resizeCanvas(windowWidth, windowHeight);
  // rebuild nodes to recenter relative to panel width
  placeGraphNodes();
  rebuildTree();
  updateDetail(active ? active : null);
}

/* helpers */
function constrain(v, a, b){ return Math.max(a, Math.min(b, v)); }

/* ========== INITIALIZE ALPHAS ========== */
/* call after placeGraphNodes or whenever expandedRoleId changes */
updateAlphasImmediate(); // set initial targets
updateAlphas();          // immediate smoothing start
