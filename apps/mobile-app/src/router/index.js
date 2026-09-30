import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import MedicationView from '../views/MedicationView.vue';
import ProfileView from '../views/ProfileView.vue';
import RecordView from '../views/RecordView.vue';
import RiskView from '../views/RiskView.vue';
const router = createRouter({
    history: createWebHistory(),
    routes: [
        { path: '/', redirect: '/home' },
        { path: '/home', component: HomeView, meta: { title: '联合治疗看板' } },
        { path: '/medications', component: MedicationView, meta: { title: '联合用药管理' } },
        { path: '/records', component: RecordView, meta: { title: '联合随访记录' } },
        { path: '/joint-events', redirect: '/risk' },
        { path: '/risk', component: RiskView, meta: { title: '联合风险判断' } },
        { path: '/profile', component: ProfileView, meta: { title: '联合治疗管理' } },
    ],
});
export default router;
