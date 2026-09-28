(() => {
 'use strict';
 const form=document.querySelector('#ta-form'); if(!form)return;
 const question=document.querySelector('#ta-question'); const course=document.querySelector('#ta-course');
 document.querySelectorAll('[data-question]').forEach(button=>button.addEventListener('click',()=>{
   question.value=button.dataset.question; if(button.dataset.course)course.value=button.dataset.course; question.focus();
 }));
 form.addEventListener('submit',event=>{
   event.preventDefault(); const text=question.value.trim();
   if(!text){document.querySelector('#ta-error').textContent='请先写下你遇到的问题，或选择一个示例问题。';question.focus();return;}
   const params=new URLSearchParams({ta:'1'});
   if(course.value){params.set('course',course.value);params.set('question',text);}else params.set('prompt',text);
   location.assign('/?'+params.toString());
 });
})();
