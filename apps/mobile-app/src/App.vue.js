import { RouterLink, RouterView } from 'vue-router';
const navItems = [
    { to: '/medications', label: '药历', icon: 'meds' },
    { to: '/records', label: '记录', icon: 'hub' },
    { to: '/home', label: '首页', icon: 'home', featured: true },
    { to: '/risk', label: '风险', icon: 'shield' },
    { to: '/profile', label: '管理', icon: 'user' },
];
const __VLS_ctx = {
    ...{},
    ...{},
};
let __VLS_components;
let __VLS_intrinsics;
let __VLS_directives;
__VLS_asFunctionalElement1(__VLS_intrinsics.main, __VLS_intrinsics.main)({
    ...{ class: "mobile-main app-main" },
});
/** @type {__VLS_StyleScopedClasses['mobile-main']} */ ;
/** @type {__VLS_StyleScopedClasses['app-main']} */ ;
let __VLS_0;
/** @ts-ignore @type {typeof __VLS_components.RouterView} */
RouterView;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent1(__VLS_0, new __VLS_0({}));
const __VLS_2 = __VLS_1({}, ...__VLS_functionalComponentArgsRest(__VLS_1));
__VLS_asFunctionalElement1(__VLS_intrinsics.nav, __VLS_intrinsics.nav)({
    ...{ class: "bottom-nav bottom-nav--custom" },
    'aria-label': "主导航",
});
/** @type {__VLS_StyleScopedClasses['bottom-nav']} */ ;
/** @type {__VLS_StyleScopedClasses['bottom-nav--custom']} */ ;
for (const [item] of __VLS_vFor((__VLS_ctx.navItems))) {
    let __VLS_5;
    /** @ts-ignore @type {typeof __VLS_components.RouterLink | typeof __VLS_components.RouterLink} */
    RouterLink;
    // @ts-ignore
    const __VLS_6 = __VLS_asFunctionalComponent1(__VLS_5, new __VLS_5({
        key: (item.to),
        to: (item.to),
        custom: true,
    }));
    const __VLS_7 = __VLS_6({
        key: (item.to),
        to: (item.to),
        custom: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_6));
    {
        const { default: __VLS_10 } = __VLS_8.slots;
        const [{ href, navigate, isActive }] = __VLS_vSlot(__VLS_10);
        __VLS_asFunctionalElement1(__VLS_intrinsics.a, __VLS_intrinsics.a)({
            ...{ onClick: (navigate) },
            href: (href),
            ...{ class: "bottom-link bottom-link--custom" },
            ...{ class: ({
                    'bottom-link--active': isActive,
                    'bottom-link--featured': item.featured,
                    'bottom-link--featured-active': item.featured && isActive,
                }) },
        });
        /** @type {__VLS_StyleScopedClasses['bottom-link']} */ ;
        /** @type {__VLS_StyleScopedClasses['bottom-link--custom']} */ ;
        /** @type {__VLS_StyleScopedClasses['bottom-link--active']} */ ;
        /** @type {__VLS_StyleScopedClasses['bottom-link--featured']} */ ;
        /** @type {__VLS_StyleScopedClasses['bottom-link--featured-active']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "bottom-link__icon" },
            ...{ class: (`bottom-link__icon--${item.icon}`) },
        });
        /** @type {__VLS_StyleScopedClasses['bottom-link__icon']} */ ;
        if (item.icon === 'home') {
            __VLS_asFunctionalElement1(__VLS_intrinsics.svg, __VLS_intrinsics.svg)({
                viewBox: "0 0 24 24",
                'aria-hidden': "true",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.path)({
                d: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z",
            });
        }
        else if (item.icon === 'meds') {
            __VLS_asFunctionalElement1(__VLS_intrinsics.svg, __VLS_intrinsics.svg)({
                viewBox: "0 0 24 24",
                'aria-hidden': "true",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.path)({
                d: "M7 4h10a2 2 0 0 1 2 2v12.5A1.5 1.5 0 0 1 17.5 20h-11A1.5 1.5 0 0 1 5 18.5V6a2 2 0 0 1 2-2Z",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.path)({
                d: "M9 9h6M9 13h6M9 17h4",
            });
        }
        else if (item.icon === 'hub') {
            __VLS_asFunctionalElement1(__VLS_intrinsics.svg, __VLS_intrinsics.svg)({
                viewBox: "0 0 24 24",
                'aria-hidden': "true",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.path)({
                d: "M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.path)({
                d: "M8 5h8M12 5v14M8 19h8",
            });
        }
        else if (item.icon === 'user') {
            __VLS_asFunctionalElement1(__VLS_intrinsics.svg, __VLS_intrinsics.svg)({
                viewBox: "0 0 24 24",
                'aria-hidden': "true",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.path)({
                d: "M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.path)({
                d: "M4.5 20a7.5 7.5 0 0 1 15 0",
            });
        }
        else {
            __VLS_asFunctionalElement1(__VLS_intrinsics.svg, __VLS_intrinsics.svg)({
                viewBox: "0 0 24 24",
                'aria-hidden': "true",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.path)({
                d: "M12 3.5 6 6v5.3c0 4.3 2.5 7.3 6 9.2 3.5-1.9 6-4.9 6-9.2V6z",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.path)({
                d: "M9.3 12.2 11 14l3.8-4",
            });
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "bottom-link__label" },
        });
        /** @type {__VLS_StyleScopedClasses['bottom-link__label']} */ ;
        (item.label);
        // @ts-ignore
        [navItems,];
        __VLS_8.slots['' /* empty slot name completion */];
    }
    var __VLS_8;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
