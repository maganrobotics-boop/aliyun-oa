(() => {
  'use strict';
  const path = location.pathname;
  const id = /newbie-python-v5/.test(path) ? 'python-basics' : (path.match(/newbie-course-v5\/([^/]+)\//) || [])[1];
  const valid = ['registration','toolkit','git-basics','python-basics','ros2-simulation','mini-project','graduation'];
  const main = document.querySelector('main');
  if (!main || !valid.includes(id) || document.querySelector('.om-lesson-frame')) return;
  const frame = document.createElement('div'); frame.className = 'om-lesson-frame';
  main.before(frame); frame.append(main);
  const aside = document.createElement('aside'); aside.className = 'om-lesson-sidebar'; aside.setAttribute('aria-label','本课导航与助教');
  const details = document.createElement('details'); details.open = window.innerWidth > 1000;
  const summary = document.createElement('summary'); summary.textContent = '本课步骤'; details.append(summary);
  const headings = [...main.querySelectorAll('h2')];
  let current = headings[0];
  const ask = document.createElement('a'); ask.className = 'om-button om-button-primary'; ask.textContent = '问本步助教';
  const setStep = heading => { current = heading; ask.href = `/?ta=1&course=${encodeURIComponent(id)}&step=${encodeURIComponent((current?.textContent || '').slice(0,120))}`; };
  headings.forEach((heading,index) => {
    if (!heading.id) heading.id = `lesson-step-${index+1}`;
    const a = document.createElement('a'); a.textContent = heading.textContent; a.href = `#${heading.id}`;
    a.onclick = () => setStep(heading); details.append(a);
  });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting).sort((a,b) => a.boundingClientRect.top-b.boundingClientRect.top);
      if (visible[0]) setStep(visible[0].target);
    },{rootMargin:'-5% 0px -65% 0px'});
    headings.forEach(h => observer.observe(h));
  }
  setStep(current);
  const help = document.createElement('p'); help.className='om-lesson-help'; help.textContent = '提问会带上课程和当前步骤；请补充命令、输出与预期结果。';
  const all = document.createElement('a'); all.href='/assets/newbie-course-v5/index.html'; all.textContent='查看全部七关';
  const submit = document.createElement('a'); submit.href=`/newbie-village#${id}`; submit.textContent='返回新手村';
  aside.append(details,ask,help,all,submit); frame.append(aside);
  for(const pre of main.querySelectorAll('pre')) {
    const button = document.createElement('button'); button.className = 'om-code-copy'; button.type='button'; button.textContent='复制代码 / 命令';
    pre.before(button);
    button.onclick=async()=>{
      const text=pre.textContent;
      try {
        if(navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
        else { const area=document.createElement('textarea'); area.value=text; document.body.append(area); area.select(); const ok=document.execCommand('copy'); area.remove(); if(!ok) throw new Error(); }
        button.textContent='已复制';
      }catch{button.textContent='请选中代码后复制';}
      setTimeout(()=>button.textContent='复制代码 / 命令',1800);
    };
  }
})();
