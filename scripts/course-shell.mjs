const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export const coursePath = (course, value) => {
 if(typeof value!=='string'||!value||value.startsWith('/')||value.includes('..')||value.includes(':'))throw new Error('Invalid course resource path');
 return '/courses/'+course.id+'/'+value;
};
export function courseHeader(course, page) {
 const ui=course.ui;
 if(!ui?.shortTitle||!ui?.reviewLabel||!Array.isArray(ui.downloads))throw new Error('Course UI metadata required: '+course.id);
 const links=[['看课件',course.slides,'slides'],['动手做',course.practice,'practice']];
 const active=page==='index.html'?'slides':page==='practice.html'?'practice':page==='deep.html'?'reading':page==='self-review.html'?'review':null;
 return `<header class="site-header course-header"><a class="brand" href="${escape(coursePath(course,course.slides))}">${escape(ui.shortTitle)}<span>AI 实践课程</span></a><nav aria-label="课程学习导航"><a href="/">课程目录</a>${links.map(([label,path,key])=>`<a data-course-nav="${key}" href="${escape(coursePath(course,path))}"${active===key?' aria-current="page"':''}>${escape(label)}</a>`).join('')}<details class="course-resources"><summary>学习资料</summary><div><a data-course-nav="reading" href="${escape(coursePath(course,course.reading))}"${active==='reading'?' aria-current="page"':''}>深入阅读（选读）</a>${course.id==='skill-engineering'?`<a data-course-nav="review" href="${escape(coursePath(course,course.review))}"${active==='review'?' aria-current="page"':''}>自评 Skill（进阶）</a>`:''}${ui.downloads.map(x=>`<a href="${escape(coursePath(course,x.path))}"${x.download===false?'':' download'}>${escape(x.label)}</a>`).join('')}</div></details>${page==='index.html'?'<button id="fullscreen" type="button">全屏 F</button>':''}</nav></header>`;
}
export function nextSteps(course, page, nextCourse) {
 const integrated=course.id==='agentic-loop';
 const primary=page==='index.html'?['开始动手做',course.practice]:integrated&&page==='practice.html'?['交流与反馈','index.html#course-feedback']:integrated?['回到动手做',course.practice]:page==='self-review.html'?['回到动手做',course.practice]:['自评 Skill（进阶）',course.review];
 const secondary=nextCourse?`<a href="${escape(coursePath(nextCourse,nextCourse.slides))}">下一门课：${escape(nextCourse.ui.shortTitle)}</a>`:'<a href="/#course-requests">建议下一门课</a>';
 return `<section class="course-next"${page==='index.html'?' data-course-end hidden':''} aria-label="接下来的学习"><h2>${page==='index.html'?'课件已到最后一页':'把这门课用起来'}</h2><p>${page==='index.html'?'接着亲手完成跟练，再按实际结果检查。':'完成跟练与检查后，可以到课程留言区分享结果或问题。'}</p><div class="course-next-actions"><a class="ui-primary" href="${escape(coursePath(course,primary[1]))}">${escape(primary[0])}</a>${primary[0]==='交流与反馈'?'':`<a href="${escape(coursePath(course,'index.html#course-feedback'))}">交流与反馈</a>`}${secondary}<a href="/">课程目录</a></div></section>`;
}
export function applyCourseShell(html,course,page,nextCourse,assetVersion){
 const header=courseHeader(course,page);
 if(!html.includes('<header class="site-header">'))throw new Error('Missing adaptable course header: '+course.id+'/'+page);
 html=html.replace(/<header class="site-header">[\s\S]*?<\/header>/,header);
 html=html.replace('</head>',`<link rel="stylesheet" href="/ui-tokens.css?v=${assetVersion}"><link rel="stylesheet" href="/course-shell.css?v=${assetVersion}"><script src="/course-shell.js?v=${assetVersion}" defer></script></head>`);
 html=html.replace('<script src="app.js" defer></script>',`<script src="/course-player.js?v=${assetVersion}" defer></script>`);
 if(page==='index.html'){
  html=html.replace('<button id="next"',`<a class="deck-next-action" href="${escape(coursePath(course,course.practice))}" hidden>开始动手做</a><button id="next"`);
  html=html.replace(/(<div class="deck-start"><a href="\/">)课程首页/, '$1课程目录');
 }
 if(page!=='poster.html')html=html.replace('</main>',`</main>${nextSteps(course,page,nextCourse)}`);
 return html;
}
