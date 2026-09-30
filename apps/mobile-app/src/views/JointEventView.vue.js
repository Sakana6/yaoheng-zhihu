import { onMounted, ref } from 'vue';
import { mobileApi } from '../lib/api';
import { formatDate, formatDateTime, formatEventType, formatRiskDirection, getRiskTone, } from '../lib/format';
const loading = ref(true);
const error = ref('');
const jointEvents = ref([]);
onMounted(async () => {
    try {
        const data = await mobileApi.getJointEvents();
        jointEvents.value = data.jointEvents;
    }
    catch (err) {
        error.value = err instanceof Error ? err.message : 'Request failed';
    }
    finally {
        loading.value = false;
    }
});
const __VLS_ctx = {
    ...{},
    ...{},
};
let __VLS_components;
let __VLS_intrinsics;
let __VLS_directives;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "mobile-page" },
});
/** @type {__VLS_StyleScopedClasses['mobile-page']} */ ;
if (__VLS_ctx.loading) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "mobile-card" },
    });
    /** @type {__VLS_StyleScopedClasses['mobile-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "section-description" },
    });
    /** @type {__VLS_StyleScopedClasses['section-description']} */ ;
}
else if (__VLS_ctx.error) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "mobile-card" },
    });
    /** @type {__VLS_StyleScopedClasses['mobile-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "section-description" },
    });
    /** @type {__VLS_StyleScopedClasses['section-description']} */ ;
    (__VLS_ctx.error);
}
else {
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "mobile-card" },
    });
    /** @type {__VLS_StyleScopedClasses['mobile-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.ul, __VLS_intrinsics.ul)({
        ...{ class: "mobile-list" },
    });
    /** @type {__VLS_StyleScopedClasses['mobile-list']} */ ;
    for (const [event] of __VLS_vFor((__VLS_ctx.jointEvents))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.li, __VLS_intrinsics.li)({
            key: (`${event.eventType}-${event.timeWindowStart}`),
            ...{ class: "mobile-list-item" },
        });
        /** @type {__VLS_StyleScopedClasses['mobile-list-item']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "mobile-list-item__row" },
        });
        /** @type {__VLS_StyleScopedClasses['mobile-list-item__row']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "section-eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['section-eyebrow']} */ ;
        (event.eventType);
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (event.eventLabel || __VLS_ctx.formatEventType(event.eventType));
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: (`status-chip status-chip--${__VLS_ctx.getRiskTone(event.severity)}`) },
        });
        (event.severity);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (__VLS_ctx.formatDate(event.eventDate));
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (__VLS_ctx.formatDateTime(event.timeWindowStart));
        (__VLS_ctx.formatDateTime(event.timeWindowEnd));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "pill-row" },
        });
        /** @type {__VLS_StyleScopedClasses['pill-row']} */ ;
        for (const [direction] of __VLS_vFor((event.riskDirections))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                key: (direction),
                ...{ class: "pill pill--soft" },
            });
            /** @type {__VLS_StyleScopedClasses['pill']} */ ;
            /** @type {__VLS_StyleScopedClasses['pill--soft']} */ ;
            (__VLS_ctx.formatRiskDirection(direction));
            // @ts-ignore
            [loading, error, error, jointEvents, formatEventType, getRiskTone, formatDate, formatDateTime, formatDateTime, formatRiskDirection,];
        }
        // @ts-ignore
        [];
    }
}
// @ts-ignore
[];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
