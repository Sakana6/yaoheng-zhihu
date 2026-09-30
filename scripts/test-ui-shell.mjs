import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync, existsSync} from 'node:fs';

// Formal entry points must never reintroduce the migration workspace or allowlist.
for (const app of ['mobile-app','doctor-web']) {
  const source=readFileSync('apps/'+app+'/src/App.vue','utf8');
  assert.doesNotMatch(source,/CareWorkspace|originalMobileRoutes|originalDoctorRoute/);
}
for (const name of ['CareWorkspace.vue','care-navigation.ts','care-presentation.css','original-ui-routes.ts'])
  assert.equal(existsSync('packages/frontend/'+name),false,'obsolete entry: '+name);

import { createServer } from 'vite';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { createRouter, createMemoryHistory } from 'vue-router';

// Component-rendering regression, not an HTTP integration test. No DB or service processes.
for (const appName of ['mobile-app', 'doctor-web']) {
  const root = path.resolve('apps', appName);
  const server = await createServer({root, configFile:path.join(root,'vite.config.ts'),
    optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:false},logLevel:'error'});
  try {
    const loadShared = name => server.ssrLoadModule('/@fs/'+path.resolve('packages/frontend', name).replaceAll('\\','/'));
    const identity = await loadShared('session.ts');
    const App = (await server.ssrLoadModule('/src/App.vue')).default;
    const isDoctor = appName === 'doctor-web';
    const Profile = !isDoctor ? (await server.ssrLoadModule('/src/views/ProfileView.vue')).default : null;
    const Home = !isDoctor ? (await server.ssrLoadModule('/src/views/HomeView.vue')).default : null;
    const Medication = !isDoctor ? (await server.ssrLoadModule('/src/views/MedicationView.vue')).default : null;
    const Record = !isDoctor ? (await server.ssrLoadModule('/src/views/RecordView.vue')).default : null;
    const Risk = !isDoctor ? (await server.ssrLoadModule('/src/views/RiskView.vue')).default : null;
    const doctorRoutes=[];
    if(isDoctor) for(const [url,view] of [['/patients','PatientsView'],['/patients/:patientId','PatientDetailView'],['/medications','MedicationManagementView'],['/patients/:patientId/summary','SummaryView'],['/follow-ups','FollowUpManagementView'],['/knowledge-base','KnowledgeBaseView']]) doctorRoutes.push({path:url,component:(await server.ssrLoadModule('/src/views/'+view+'.vue')).default});
    const render = async url => {
      const router = createRouter({history:createMemoryHistory(),routes:[...(!isDoctor ? [{path:'/profile',component:Profile},{path:'/home',component:Home},{path:'/medications',component:Medication},{path:'/records',component:Record},{path:'/risk',component:Risk}] : doctorRoutes),{path:'/:rest(.*)*',component:{template:'<div>LEGACY_DATA_VIEW</div>'}}]});
      await router.push(url); await router.isReady();
      return renderToString(createSSRApp(App).use(router));
    };
    identity.clearSession();
    let html = await render(isDoctor?'/patients':'/home');
    assert.match(html,/一键登录本地测试账号/);
    assert.match(html,/使用其他账号/);
    assert.match(html,/autocomplete="username"/);
    assert.doesNotMatch(html,/care-workspace/);
    identity.session.value={token:'synthetic-test-only',userId:7,role:isDoctor?'DOCTOR':'CAREGIVER'};
    if(isDoctor){const transient=await render('/patients?care=risk');assert.doesNotMatch(transient,/care-workspace/);assert.match(transient,/刷新患者列表/);}
    identity.patients.value=[{id:42,name:'合成患者甲'},{id:73,name:'合成患者乙'}];
    identity.selectPatient(42);
    const cases = isDoctor ? [
      ['/patients','home','授权患者'],['/patients/42','patient','本次复核重点'],
      ['/patients/42/summary','risk','正在读取医生摘要视图'],['/medications','medications','用药管理'],
      ['/follow-ups','follow-ups','随访管理'],['/knowledge-base','knowledge-base','将在后续阶段开放'],

    ] : [['/home','home','用药与随访提醒'],['/medications','medications','药历管理'],['/records','records','反馈记录'],['/risk','risk','证据与分析'],['/profile','profile','提醒计划']];
    for (const [url,page,label] of cases) {
      html=await render(url);
      if (!isDoctor && ['profile','home','medications','records','risk'].includes(page)) {
        assert.match(html,new RegExp(`mobile-page ${{medications:'medication',records:'record'}[page] ?? page}-page`));
        assert.doesNotMatch(html,/care-workspace/);
        if (page==='home') { assert.doesNotMatch(html,/血压水平正常|早间降压药未按时服用|当前暂无联合治疗风险/); assert.match(html,/尚无成功分析快照/); }
        if (page==='risk') { assert.doesNotMatch(html,/93%|>92<|>58<|>44<|>90</); assert.match(html,/复核随访与报告/); }
      } else if (isDoctor && ['/patients','/patients/42','/medications','/patients/42/summary','/follow-ups','/knowledge-base'].includes(url)) {
        assert.doesNotMatch(html,/care-workspace/);
        assert.ok(html.includes(label),url);
        if(url==='/patients') {assert.match(html,/doctor-dashboard/);assert.match(html,/暂无排班数据/);assert.doesNotMatch(html,/王建国|张医生|较昨日|需升级处理 2 次/);assert.match(html,/href="\/patients\/73"/);}
        if(url==='/patients/42') {assert.match(html,/detail-hero/);assert.match(html,/尚无成功分析快照/);assert.match(html,/当前药历/);assert.match(html,/当日确认记录/);}
        if(url==='/patients/42/summary') {assert.match(html,/page-state/);assert.doesNotMatch(html,/打开后端下载地址|iframe/);}
        if(url==='/knowledge-base'){assert.match(html,/dataset-stack/);assert.doesNotMatch(html,/3w\+|2w\+|正规医疗库/);}
        if(url==='/medications') {assert.match(html,/当前患者用药列表/);assert.match(html,/单药风险评估/);}
      } else {
        assert.match(html,new RegExp(`data-page="${page}"`),url);
        assert.ok(html.includes(label),url);
      }
      assert.ok(html.includes(isDoctor?'doctor-sidebar':'bottom-nav--custom'),url);
      if (isDoctor) {
        assert.doesNotMatch(html,/class="session-bar"|本地服务 ·|医生查看与报告|刷新授权患者/);
        assert.equal(html.includes('退出登录'),page==='patient');
        if(page==='patient') assert.match(html,/<footer[^>]*class="doctor-session-actions"/);
      }
      else {
        assert.doesNotMatch(html,/class="session-bar"|刷新授权患者|本地服务 ·/);
        assert.equal(html.includes('退出登录'),page==='profile');
      }
      assert.doesNotMatch(html,/LEGACY_DATA_VIEW/,url+' must not mount legacy data logic');
      if(isDoctor)assert.doesNotMatch(html,/<button[^>]*>\s*(新增药品|新增提醒计划|主动记录)\s*<\/button>/);
    }
    identity.selectPatient(73);
    html=await render(isDoctor?'/patients/73':'/medications');
    assert.match(html,/合成患者乙/);
    if(isDoctor) {assert.match(html,/href="\/patients\/73"/);assert.doesNotMatch(html,/href="\/patients\/1"/);}
    if(isDoctor) {
      for(const url of ['/patients/1','/patients/999','/patients/invalid','/patients/0','/patients/999/summary']) {
        html=await render(url);assert.match(html,/没有该患者的访问权限/);assert.doesNotMatch(html,/care-workspace|detail-hero/);assert.equal(identity.selectedPatient.value.id,73);
      }
      identity.session.value={token:'synthetic',userId:7,role:'CAREGIVER'};
      html=await render('/patients');assert.match(html,/当前账号无医生端访问权限/);assert.doesNotMatch(html,/doctor-dashboard|care-workspace/);
      assert.match(html,/退出登录/);
      identity.session.value={token:'synthetic',userId:7,role:'DOCTOR'};identity.patients.value=[];identity.selectPatient(-1);
      for(const url of ['/patients','/patients/73','/medications','/follow-ups']) {
        html=await render(url);assert.match(html,/退出登录/);assert.doesNotMatch(html,/class="session-bar"|detail-hero|care-workspace|manage-hero/);
        if(url==='/patients')assert.match(html,/刷新患者列表/);else assert.match(html,/没有授权患者/);
      }
    }
    if(!isDoctor) {
      html=await render('/risk?workspace=followups');
      assert.doesNotMatch(html,/care-workspace/);
      assert.match(html,/复核随访与报告/);
      assert.match(html,/mobile-page risk-page/);
      assert.match(html,/查看随访与复核历史/);
      assert.match(html,/家属报告/);
      html=await render('/risk');
      assert.match(html,/mobile-page risk-page/);
      assert.doesNotMatch(html,/care-workspace/);
      for (const page of ['home','profile']) {
        html=await render('/'+page+'?workspace=followups');
        assert.match(html,new RegExp('mobile-page '+page+'-page'));
        assert.doesNotMatch(html,/care-workspace/);
      }
      identity.selectPatient(-1);
      html=await render('/profile');
      assert.match(html,/没有授权患者/);
      assert.match(html,/退出登录/);
      assert.doesNotMatch(html,/care-workspace|mobile-page profile-page/);
    }
    identity.clearSession();
    html=await render('/medications');
    assert.doesNotMatch(html,/care-workspace/);
    console.log(`PASS ${appName}: original navigation, real components, all routes, role controls, patient switch and logout`);
  } finally { await server.close(); }
}
