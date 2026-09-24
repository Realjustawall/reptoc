import test from 'node:test';import assert from 'node:assert/strict';import React from'react';import{renderToStaticMarkup}from'react-dom/server';
import WorldbuildingWorkspace,{EntityPicker,GraphEditor,MapsEditor,RelationshipDialog,Timelines}from'../src/components/worldbuilding/WorldbuildingWorkspace';import Premium from'../src/components/Premium';import PremiumManagementCards from'../src/components/PremiumManagementCards';
test('workspace renders its accessible loading state and novel identity',()=>{const html=renderToStaticMarkup(<WorldbuildingWorkspace novel={{id:'novel-a',title:'Test Novel',author_id:'author-a'}} currentUser={null} theme="dark" onBack={()=>{}} onUpgrade={()=>{}}/>);assert.match(html,/Test Novel/);assert.match(html,/در حال بارگذاری محیط رمان/);assert.match(html,/بخش‌های جهان‌سازی/)});
test('premium purchase page exposes independently priced plan selectors',()=>{
  const html=renderToStaticMarkup(<Premium theme="dark"/>);
  assert.match(html,/پریمیوم خواننده/);
  assert.match(html,/پریمیوم نویسنده/);
  // Reader is $2/month; Writer is $2 discounted to $1.50, so both figures and the
  // struck-through list price must be on the page without switching plans.
  assert.match(html,/\$2/);
  assert.match(html,/\$1\.50/);
  assert.match(html,/line-through/);
});
test('admin premium cards expose a deterministic loading state',()=>{const html=renderToStaticMarkup(<PremiumManagementCards userId="user-a"/>);assert.match(html,/در حال بارگذاری سوابق پریمیوم/)});
const noop=async()=>{};
test('interactive graph renders canvas controls, filters and keyboard fallback',()=>{const html=renderToStaticMarkup(<GraphEditor nodes={[]} edges={[]} resources={[]} theme="dark" readOnly create={noop} update={noop} remove={noop}/>);assert.match(html,/گراف جهان/);assert.match(html,/تنظیم نما/);assert.match(html,/فیلتر نوع رابطه/);assert.match(html,/گره‌های گراف قابل دسترسی با کیبورد/)});
test('relationship editor exposes complete directional relationship fields',()=>{const node:any={id:'n1',name:'One'};const html=renderToStaticMarkup(<RelationshipDialog nodes={[node,{id:'n2',name:'Two'}]} source={node} onClose={()=>{}} onSave={noop}/>);for(const label of['مبدأ','هدف','نوع رابطه','اهمیت','تاریخ شروع','تاریخ پایان','جهت'])assert.match(html,new RegExp(label))});
test('map and timeline visual editors expose graphical navigation and empty states',()=>{const map=renderToStaticMarkup(<MapsEditor maps={[]} pins={[]} all={[]} readOnly create={noop} update={noop} remove={noop}/>);assert.match(map,/نقشه‌های جهان/);const timeline=renderToStaticMarkup(<Timelines timelines={[]} events={[]} all={[]} readOnly create={noop} update={noop} remove={noop} reorder={noop} theme="dark"/>);assert.match(timeline,/خطوط زمانی/);assert.match(timeline,/خط زمانی بسازید یا انتخاب کنید/)});
test('cross-link picker renders search, type filter and selected chips',()=>{const resources:any[]=[{id:'a',name:'Lore A',resource_type:'lore'}];const html=renderToStaticMarkup(<EntityPicker resources={resources} value={['a']} onChange={()=>{}}/>);assert.match(html,/جستجوی موجودیت‌های مرتبط/);assert.match(html,/فیلتر نوع موجودیت/);assert.match(html,/Lore A/)});
