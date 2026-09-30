<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';

import InfoPanel from '../components/InfoPanel.vue';
import MetricCard from '../components/MetricCard.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { doctorApi } from '../lib/api';
import {
  formatAdherenceStatus,
  formatDateTime,
  formatFollowUpChannel,
  formatFollowUpType,
  formatMealStatus,
  formatStatus,
} from '../lib/format';
import type { FollowUpFeedbackRecord } from '../lib/types';

const loading = ref(true);
const error = ref('');
const records = ref<FollowUpFeedbackRecord[]>([]);

const metrics = computed(() => {
  if(!useMock){const all=followups.value;return [{title:'全部随访',value:all.length,subtitle:'当前患者的真实任务',tone:'info' as const,progress:100},...(['PENDING','COMPLETED','CANCELLED'] as const).map(status=>({title:labels[status],value:all.filter(f=>f.status===status).length,subtitle:'按任务状态统计',tone:'info' as const,progress:all.length?all.filter(f=>f.status===status).length/all.length*100:0}))];}
  const all = records.value;
  const escalated = all.filter((item) => item.status === 'ESCALATED').length;
  const reviewed = all.filter((item) => item.status === 'REVIEWED').length;
  const linked = all.filter((item) => item.linkedEventType).length;
  const patientCount = new Set(all.map((item) => item.patientId)).size;

  return [
    { title: '全部反馈', value: all.length, subtitle: '展示用户的每次事件反馈', tone: 'info' as const, progress: 100 },
    { title: '升级处理', value: escalated, subtitle: '需要医生重点跟进的反馈', tone: 'danger' as const, progress: all.length ? (escalated / all.length) * 100 : 0 },
    { title: '已复核', value: reviewed, subtitle: '已完成医生确认或回访', tone: 'success' as const, progress: all.length ? (reviewed / all.length) * 100 : 0 },
    { title: '关联事件', value: linked, subtitle: `涉及 ${patientCount} 位患者`, tone: 'warning' as const, progress: all.length ? (linked / all.length) * 100 : 0 },
  ];
});

async function loadFollowUps() {
  loading.value = true;
  error.value = '';

  try {
    const response = await doctorApi.getFollowUpRecords();
    records.value = response.records;
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载随访数据失败';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if(useMock)void loadFollowUps();else void loadReal();
});

import {RouterLink} from 'vue-router';
import {useMock,selectedPatient} from '../../../../packages/frontend/session';
import {useFollowUpState} from '../../../../packages/frontend/followup-state';
import {displayTime} from '../../../../packages/frontend/care';
const state=useFollowUpState();
const {followups,reviews,error:realError,notice,busy,reviewId,required,due,instruction,editing,editDue,editInstruction,labels}=state;
const creating=ref(false);
let alive=true;
async function loadReal(){await state.load();if(alive)loading.value=false;}
async function createTask(){if(await state.create())creating.value=false;}
onBeforeUnmount(()=>{alive=false;state.dispose();});
</script>

<template>
  <div class="page-stack">
    <section class="hero-banner manage-hero">
      <div>
        <p class="hero-banner__eyebrow">Follow-up Feedback</p>
        <h1>随访管理</h1>
        <p class="hero-banner__lead">
          {{useMock?'汇总用户事件反馈和后续处理动作。':'查看当前患者的复核、补充资料任务及回复状态。'}}
        </p>
      </div>
    </section>

    <section v-if="loading" class="page-state">
      <p>正在加载随访反馈...</p>
    </section>

    <section v-else-if="error" class="page-state page-state--error">
      <p>{{ error }}</p>
    </section>

    <template v-else>
      <section class="metric-grid">
        <MetricCard
          v-for="item in metrics"
          :key="item.title"
          :title="item.title"
          :value="item.value"
          :subtitle="item.subtitle"
          :tone="item.tone"
          :progress="item.progress"
        />
      </section>

      <div v-if="!useMock" class="followup-actions"><button class="button button--ghost" @click="loadReal">刷新随访</button><button class="button button--primary" :disabled="busy" @click="creating=true">创建随访</button><RouterLink class="button button--ghost" :to="'/patients/'+selectedPatient?.id+'/summary'">查看报告 / 追加复核</RouterLink><p role="alert">{{realError}}</p><p role="status">{{notice}}</p></div>
      <InfoPanel
        kicker="All Feedback"
        :title="useMock?'事件反馈全量列表':'当前患者随访任务'"
        subtitle="按任务编号追溯来源复核、分析快照与完成记录。"
      >
        <div v-if="useMock" class="feedback-list">
          <article v-for="item in records" :key="item.id" class="feedback-card">
            <div class="feedback-card__head">
              <div>
                <p class="feedback-card__eyebrow">{{ item.patientName }} / 患者 ID {{ item.patientId }}</p>
                <h3>{{ item.feedbackSummary }}</h3>
                <p class="feedback-card__time">{{ formatDateTime(item.eventDate) }}</p>
              </div>
              <StatusBadge
                :label="formatStatus(item.status).label"
                :tone="formatStatus(item.status).tone"
              />
            </div>

            <div class="feedback-card__meta">
              <span>{{ formatFollowUpType(item.eventType) }}</span>
              <span>{{ formatFollowUpChannel(item.channel) }}</span>
              <span>服药状态：{{ formatAdherenceStatus(item.adherenceStatus) }}</span>
              <span>进食状态：{{ formatMealStatus(item.mealStatus) }}</span>
            </div>

            <div v-if="item.symptoms.length" class="feedback-card__symptoms">
              <span v-for="symptom in item.symptoms" :key="symptom" class="tag tag--soft">{{ symptom }}</span>
            </div>

            <div class="feedback-card__footer">
              <p>{{ item.nextAction }}</p>
              <StatusBadge
                v-if="item.linkedEventType"
                :label="`关联 ${item.linkedEventType} / ${item.linkedEventDate}`"
                tone="info"
              />
            </div>
          </article>
        </div>
        <div v-else class="feedback-list">
          <p v-if="!followups.length">暂无随访任务。先在报告页追加复核，再创建补充资料任务。</p>
          <article v-for="item in followups" :key="item.followUpId" class="feedback-card">
            <div class="feedback-card__head"><div><p class="feedback-card__eyebrow">{{item.followUpId}}</p><h3>{{item.instruction}}</h3><p class="feedback-card__time">截止 {{displayTime(item.dueAt)}} · 版本 {{item.version}}</p></div><StatusBadge :label="labels[item.status] ?? item.status" :tone="item.status==='COMPLETED'?'success':'info'" /></div>
            <div class="feedback-card__meta"><span>所需资料：{{item.requiredFields.map(f=>labels[f]??f).join('、')}}</span><span>来源复核 {{item.sourceReviewId}}</span><span>快照 {{item.snapshotId}}</span></div>
            <div class="feedback-card__footer"><p>{{item.completedRecordId?'完成记录 '+item.completedRecordId:'尚无完成记录'}}</p><button v-if="item.status==='PENDING'" class="button button--ghost" :disabled="busy" @click="state.edit(item)">修改 / 取消随访</button><RouterLink :to="{path:'/patients/'+selectedPatient?.id+'/summary',query:{runId:item.analysisRunId,snapshotId:item.snapshotId}}">查看来源报告</RouterLink></div>
          </article>
        </div>
      </InfoPanel>
      <InfoPanel v-if="!useMock" kicker="Reviews" title="复核历史" subtitle="保留医生意见及其对应快照，不改写机器分析结果。"><div class="feedback-list"><p v-if="!reviews.length">暂无复核意见。</p><article v-for="item in reviews" :key="item.reviewId" class="feedback-card"><h3>{{labels[item.status]}}</h3><p>{{item.comment}}</p><p>理由：{{item.reason}}</p><p>{{item.historical?'历史快照 · ':''}}{{item.snapshotId}}</p><RouterLink :to="{path:'/patients/'+selectedPatient?.id+'/summary',query:{runId:item.analysisRunId,snapshotId:item.snapshotId}}">查看复核快照</RouterLink></article></div></InfoPanel>
      <div v-if="creating || editing" class="followup-overlay" role="dialog" aria-modal="true" :aria-label="editing?'修改随访':'创建随访'">
        <form class="followup-dialog" @submit.prevent="editing?state.update():createTask()"><h2>{{editing?'修改随访':'创建补充资料随访'}}</h2><fieldset :disabled="busy">
          <template v-if="!editing"><label>来源复核<select v-model="reviewId" required><option value="">请选择</option><option v-for="r in reviews" :key="r.reviewId" :value="r.reviewId">{{labels[r.status]}} · {{r.snapshotId}} · {{r.reviewId}}</option></select></label>
          <label v-for="field in ['BLOOD_GLUCOSE','BLOOD_PRESSURE','SYMPTOM','ADHERENCE']" :key="field" class="field-choice"><input v-model="required" type="checkbox" :value="field" />{{labels[field]}}</label>
          <label>截止时间（北京时间）<input v-model="due" type="datetime-local" step="1" required /></label><label>随访说明<textarea v-model="instruction" required maxlength="1000" /></label></template>
          <template v-else><p>编辑版本 {{editing.version}}；遇到冲突请关闭并刷新，重新核对后编辑。</p><label>新截止时间<input v-model="editDue" type="datetime-local" step="1" required /></label><label>新说明<textarea v-model="editInstruction" required maxlength="1000" /></label></template>
          <p role="alert">{{realError}}</p><button class="button button--primary">{{editing?'保存修改':'创建随访'}}</button><button v-if="editing" type="button" class="button button--ghost" @click="state.update(true)">确认取消随访</button><button type="button" class="button button--ghost" @click="editing=null;creating=false">关闭</button>
        </fieldset></form>
      </div>
    </template>
  </div>
</template>

<style scoped>
.followup-actions {display:flex;gap:12px;flex-wrap:wrap;align-items:center;}
.feedback-card {overflow-wrap:anywhere;}
.followup-overlay {position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:20px;background:rgba(25,50,68,.35);}
.followup-dialog {width:min(660px,100%);max-height:85vh;overflow:auto;border-radius:24px;padding:24px;background:#f7fbff;}
.followup-dialog fieldset {border:0;display:grid;gap:14px;min-width:0;}
.followup-dialog label {display:grid;gap:8px;}
.followup-dialog .field-choice {display:flex;align-items:center;}
.followup-dialog input,.followup-dialog textarea,.followup-dialog select {padding:10px;border:1px solid #dce6ef;border-radius:10px;max-width:100%;}

.manage-hero {
  padding: 12px 6px 0;
}

.manage-hero h1 {
  margin: 0;
  font-size: 46px;
  line-height: 0.98;
  color: var(--ink-strong);
  letter-spacing: -0.04em;
}

.manage-hero p {
  margin: 10px 0 0;
}

.feedback-list {
  display: grid;
  gap: 16px;
}

.feedback-card {
  display: grid;
  gap: 14px;
  padding: 20px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(220, 230, 239, 0.92);
}

.feedback-card__head,
.feedback-card__footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.feedback-card__eyebrow {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #178494;
}

.feedback-card h3 {
  margin: 0;
  font-size: 22px;
  line-height: 1.4;
  color: var(--ink-strong);
}

.feedback-card__time,
.feedback-card__footer p {
  margin: 8px 0 0;
  color: var(--ink-soft);
  line-height: 1.7;
}

.feedback-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  color: #607691;
  font-size: 14px;
  font-weight: 600;
}

.feedback-card__symptoms {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 720px) {
  .manage-hero h1 {
    font-size: 38px;
  }

  .feedback-card__head,
  .feedback-card__footer {
    flex-direction: column;
  }
}
</style>
