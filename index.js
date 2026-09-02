/**
 * Additional Info Tooltips for SillyTavern.
 *
 * Shows the complete text of <small class="ch_additional_info"> elements on
 * mouse hover and after a long press on touch devices. Event delegation keeps
 * the behavior working when SillyTavern rebuilds its character/persona lists.
 */

const TARGET_SELECTOR = 'small.ch_additional_info';
const TOOLTIP_ID = 'ait-full-text-tooltip';
const INSTANCE_KEY = Symbol.for('sillytavern.additional-info-tooltip.instance');

const HOVER_DELAY_MS = 120;
const HOVER_EXIT_DELAY_MS = 180;
const LONG_PRESS_DELAY_MS = 550;
const LONG_PRESS_MOVE_TOLERANCE_PX = 12;
const CLICK_SUPPRESSION_MS = 1_000;
const VIEWPORT_MARGIN_PX = 8;
const TARGET_GAP_PX = 10;
const CLICK_SCOPE_SELECTOR = '.avatar-container, .character_select, .group_select, .bogus_folder_select';

const MODE = Object.freeze({
    HOVER: 'hover',
    FOCUS: 'focus',
    LONG_PRESS: 'long-press',
});

/**
 * @param {EventTarget | null} node
 * @returns {HTMLElement | null}
 */
function getTarget(node) {
    const element = node instanceof Element ? node : null;
    const target = element?.closest(TARGET_SELECTOR);
    return target instanceof HTMLElement ? target : null;
}

/**
 * @param {number} value
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

/**
 * @param {HTMLElement} target
 * @returns {string}
 */
function getFullText(target) {
    return target.textContent?.trim() ?? '';
}

/**
 * Add the tooltip to the target's accessible description without replacing
 * descriptions supplied by SillyTavern or another extension.
 *
 * @param {HTMLElement} target
 */
function addAriaDescription(target) {
    const ids = (target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    if (!ids.includes(TOOLTIP_ID)) {
        ids.push(TOOLTIP_ID);
        target.setAttribute('aria-describedby', ids.join(' '));
    }
}

/**
 * @param {HTMLElement} target
 */
function removeAriaDescription(target) {
    const ids = (target.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter(id => id && id !== TOOLTIP_ID);

    if (ids.length > 0) {
        target.setAttribute('aria-describedby', ids.join(' '));
    } else {
        target.removeAttribute('aria-describedby');
    }
}

function createController() {
    const abortController = new AbortController();
    const { signal } = abortController;

    const tooltip = document.createElement('div');
    tooltip.id = TOOLTIP_ID;
    tooltip.className = 'ait-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    document.body.append(tooltip);

    /** @type {HTMLElement | null} */
    let activeTarget = null;
    /** @type {string | null} */
    let activeMode = null;
    /** @type {HTMLElement | null} */
    let hoverCandidate = null;
    /** @type {number | null} */
    let hoverTimer = null;
    /** @type {number | null} */
    let hoverExitTimer = null;
    let tooltipHovered = false;
    /** @type {number | null} */
    let positionFrame = null;

    /**
     * @typedef {object} PressState
     * @property {number} pointerId
     * @property {HTMLElement} target
     * @property {number} startX
     * @property {number} startY
     * @property {number | null} timer
     * @property {boolean} triggered
     * @property {boolean} dismissOnly
     */

    /** @type {PressState | null} */
    let pressState = null;
    /** @type {HTMLElement | null} */
    let suppressedClickTarget = null;
    /** @type {HTMLElement | null} */
    let suppressedClickScope = null;
    let suppressClickUntil = 0;
    /** @type {number | null} */
    let suppressionTimer = null;
    let suppressionGeneration = 0;

    function clearHoverTimer() {
        if (hoverTimer !== null) {
            window.clearTimeout(hoverTimer);
            hoverTimer = null;
        }
        hoverCandidate = null;
    }

    function clearHoverExitTimer() {
        if (hoverExitTimer !== null) {
            window.clearTimeout(hoverExitTimer);
            hoverExitTimer = null;
        }
    }

    /** @param {HTMLElement} target */
    function scheduleHoverExit(target) {
        clearHoverExitTimer();
        hoverExitTimer = window.setTimeout(() => {
            hoverExitTimer = null;
            if (!tooltipHovered && activeTarget === target && activeMode === MODE.HOVER) {
                hideTooltip();
            }
        }, HOVER_EXIT_DELAY_MS);
    }

    function cancelPositionFrame() {
        if (positionFrame !== null) {
            window.cancelAnimationFrame(positionFrame);
            positionFrame = null;
        }
    }

    function cancelPress() {
        if (pressState?.timer !== null && pressState?.timer !== undefined) {
            window.clearTimeout(pressState.timer);
        }
        pressState = null;
    }

    function suppressNextClick(target) {
        if (suppressionTimer !== null) {
            window.clearTimeout(suppressionTimer);
        }

        suppressedClickTarget = target;
        suppressedClickScope = target.closest(CLICK_SCOPE_SELECTOR) ?? target;
        suppressClickUntil = performance.now() + CLICK_SUPPRESSION_MS;
        const generation = ++suppressionGeneration;
        suppressionTimer = window.setTimeout(() => {
            if (suppressionGeneration === generation) {
                clearClickSuppression();
            }
        }, CLICK_SUPPRESSION_MS);
    }

    function clearClickSuppression() {
        suppressionGeneration++;
        if (suppressionTimer !== null) {
            window.clearTimeout(suppressionTimer);
            suppressionTimer = null;
        }
        suppressedClickTarget = null;
        suppressedClickScope = null;
        suppressClickUntil = 0;
    }

    function hideTooltip() {
        clearHoverTimer();
        clearHoverExitTimer();
        cancelPositionFrame();
        observer.disconnect();
        resizeObserver?.disconnect();

        if (activeTarget) {
            removeAriaDescription(activeTarget);
        }

        activeTarget = null;
        activeMode = null;
        tooltipHovered = false;
        tooltip.hidden = true;
        tooltip.removeAttribute('data-placement');
        tooltip.removeAttribute('data-visible');
        tooltip.textContent = '';
    }

    function positionTooltip() {
        positionFrame = null;

        if (!activeTarget || tooltip.hidden || !activeTarget.isConnected) {
            hideTooltip();
            return;
        }

        const visualViewport = window.visualViewport;
        const viewportLeft = visualViewport?.offsetLeft ?? 0;
        const viewportTop = visualViewport?.offsetTop ?? 0;
        const viewportWidth = visualViewport?.width ?? window.innerWidth;
        const viewportHeight = visualViewport?.height ?? window.innerHeight;
        const viewportRight = viewportLeft + viewportWidth;
        const viewportBottom = viewportTop + viewportHeight;
        tooltip.style.maxWidth = `min(32rem, ${Math.max(1, viewportWidth - (VIEWPORT_MARGIN_PX * 2))}px)`;
        tooltip.style.maxHeight = `${Math.max(1, viewportHeight - (VIEWPORT_MARGIN_PX * 2))}px`;

        const targetRect = activeTarget.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();

        const centeredLeft = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
        const left = clamp(
            centeredLeft,
            viewportLeft + VIEWPORT_MARGIN_PX,
            viewportRight - tooltipRect.width - VIEWPORT_MARGIN_PX,
        );

        const aboveTop = targetRect.top - tooltipRect.height - TARGET_GAP_PX;
        const belowTop = targetRect.bottom + TARGET_GAP_PX;
        const fitsAbove = aboveTop >= viewportTop + VIEWPORT_MARGIN_PX;
        const fitsBelow = belowTop + tooltipRect.height <= viewportBottom - VIEWPORT_MARGIN_PX;
        const spaceAbove = targetRect.top - viewportTop;
        const spaceBelow = viewportBottom - targetRect.bottom;
        const placeAbove = fitsAbove || (!fitsBelow && spaceAbove >= spaceBelow);
        const placement = placeAbove ? 'above' : 'below';
        const preferredTop = placeAbove ? aboveTop : belowTop;
        const top = clamp(
            preferredTop,
            viewportTop + VIEWPORT_MARGIN_PX,
            viewportBottom - tooltipRect.height - VIEWPORT_MARGIN_PX,
        );

        const targetCenter = targetRect.left + (targetRect.width / 2);
        const arrowX = clamp(targetCenter - left, 12, tooltipRect.width - 12);

        tooltip.style.left = `${Math.round(left)}px`;
        tooltip.style.top = `${Math.round(top)}px`;
        tooltip.style.setProperty('--ait-arrow-x', `${Math.round(arrowX)}px`);
        tooltip.dataset.placement = placement;
    }

    function queuePosition() {
        cancelPositionFrame();
        positionFrame = window.requestAnimationFrame(positionTooltip);
    }

    /**
     * @param {HTMLElement} target
     * @param {string} mode
     */
    function showTooltip(target, mode) {
        const fullText = getFullText(target);
        if (!fullText) {
            hideTooltip();
            return;
        }

        clearHoverTimer();

        if (activeTarget && activeTarget !== target) {
            removeAriaDescription(activeTarget);
        }

        activeTarget = target;
        activeMode = mode;
        tooltip.textContent = fullText;
        tooltip.hidden = false;
        tooltip.dataset.visible = 'true';
        addAriaDescription(target);
        observer.disconnect();
        observer.observe(document.body, { childList: true, characterData: true, subtree: true });
        resizeObserver?.disconnect();
        resizeObserver?.observe(target);
        if (target.parentElement) {
            resizeObserver?.observe(target.parentElement);
        }
        queuePosition();
    }

    /** @param {PointerEvent} event */
    function onPointerOver(event) {
        if (event.pointerType === 'touch' || event.pointerType === 'pen') {
            return;
        }

        const target = getTarget(event.target);
        if (!target) {
            return;
        }

        clearHoverExitTimer();

        const previous = event.relatedTarget;
        if (previous instanceof Node && target.contains(previous)) {
            return;
        }

        if (activeTarget === target && activeMode === MODE.HOVER) {
            return;
        }

        clearHoverTimer();
        hoverCandidate = target;
        hoverTimer = window.setTimeout(() => {
            hoverTimer = null;
            if (hoverCandidate === target && target.isConnected) {
                showTooltip(target, MODE.HOVER);
            }
        }, HOVER_DELAY_MS);
    }

    /** @param {PointerEvent} event */
    function onPointerOut(event) {
        if (event.pointerType === 'touch' || event.pointerType === 'pen') {
            return;
        }

        const target = getTarget(event.target);
        if (!target) {
            return;
        }

        const next = event.relatedTarget;
        if (next instanceof Node && target.contains(next)) {
            return;
        }

        if (hoverCandidate === target) {
            clearHoverTimer();
        }
        if (activeTarget === target && activeMode === MODE.HOVER) {
            const nextIsTooltip = next instanceof Node && tooltip.contains(next);
            if (!nextIsTooltip) {
                scheduleHoverExit(target);
            }
        }
    }

    /** @param {PointerEvent} event */
    function onTooltipPointerEnter(event) {
        if (event.pointerType === 'touch') {
            return;
        }
        tooltipHovered = true;
        clearHoverExitTimer();
    }

    /** @param {PointerEvent} event */
    function onTooltipPointerLeave(event) {
        if (event.pointerType === 'touch') {
            return;
        }
        tooltipHovered = false;

        const next = event.relatedTarget;
        if (activeTarget && next instanceof Node && activeTarget.contains(next)) {
            clearHoverExitTimer();
            return;
        }
        if (activeTarget && activeMode === MODE.HOVER) {
            scheduleHoverExit(activeTarget);
        }
    }

    /** @param {FocusEvent} event */
    function onFocusIn(event) {
        const target = getTarget(event.target);
        if (target) {
            showTooltip(target, MODE.FOCUS);
        }
    }

    /** @param {FocusEvent} event */
    function onFocusOut(event) {
        const target = getTarget(event.target);
        if (!target || activeTarget !== target || activeMode !== MODE.FOCUS) {
            return;
        }

        const next = event.relatedTarget;
        if (!(next instanceof Node) || !target.contains(next)) {
            hideTooltip();
        }
    }

    /** @param {PointerEvent} event */
    function onPointerDown(event) {
        const target = getTarget(event.target);
        const isInsideTooltip = event.target instanceof Node && tooltip.contains(event.target);

        if (activeMode === MODE.LONG_PRESS && activeTarget) {
            if (isInsideTooltip) {
                cancelPress();
                return;
            }
            if (target === activeTarget) {
                hideTooltip();
                cancelPress();
                pressState = {
                    pointerId: event.pointerId,
                    target,
                    startX: event.clientX,
                    startY: event.clientY,
                    timer: null,
                    triggered: false,
                    dismissOnly: true,
                };
                return;
            }
            hideTooltip();
        }

        const isTouchLike = event.pointerType === 'touch' || event.pointerType === 'pen';
        if (isTouchLike && (activeMode === MODE.HOVER || activeMode === MODE.FOCUS)) {
            hideTooltip();
        }

        if (!isTouchLike) {
            return;
        }
        if (!event.isPrimary || event.button !== 0 || !target) {
            cancelPress();
            return;
        }

        cancelPress();
        const state = {
            pointerId: event.pointerId,
            target,
            startX: event.clientX,
            startY: event.clientY,
            timer: null,
            triggered: false,
            dismissOnly: false,
        };

        state.timer = window.setTimeout(() => {
            if (pressState !== state || !target.isConnected) {
                return;
            }

            state.timer = null;
            state.triggered = true;
            suppressNextClick(target);
            showTooltip(target, MODE.LONG_PRESS);
        }, LONG_PRESS_DELAY_MS);
        pressState = state;
    }

    /** @param {PointerEvent} event */
    function onPointerMove(event) {
        if (!pressState || event.pointerId !== pressState.pointerId || pressState.triggered) {
            return;
        }

        const deltaX = event.clientX - pressState.startX;
        const deltaY = event.clientY - pressState.startY;
        if (Math.hypot(deltaX, deltaY) > LONG_PRESS_MOVE_TOLERANCE_PX) {
            cancelPress();
        }
    }

    /** @param {PointerEvent} event */
    function onPointerUp(event) {
        if (!pressState || event.pointerId !== pressState.pointerId) {
            return;
        }

        const { target, triggered, dismissOnly } = pressState;
        cancelPress();

        if (triggered || dismissOnly) {
            suppressNextClick(target);
            if (event.cancelable) {
                event.preventDefault();
            }
            event.stopPropagation();
        }
    }

    /** @param {PointerEvent} event */
    function onPointerCancel(event) {
        if (!pressState || event.pointerId !== pressState.pointerId) {
            return;
        }

        const wasTriggered = pressState.triggered;
        cancelPress();
        if (wasTriggered && activeMode === MODE.LONG_PRESS) {
            hideTooltip();
        }
    }

    /** @param {MouseEvent} event */
    function onClick(event) {
        if (!suppressedClickTarget) {
            return;
        }

        if (performance.now() > suppressClickUntil) {
            clearClickSuppression();
            return;
        }

        const clickNode = event.target instanceof Node ? event.target : null;
        const isTargetClick = Boolean(clickNode && suppressedClickTarget.contains(clickNode));
        const isScopedRetarget = Boolean(clickNode && suppressedClickScope?.contains(clickNode));

        if (isTargetClick || isScopedRetarget) {
            if (event.cancelable) {
                event.preventDefault();
            }
            event.stopImmediatePropagation();
            clearClickSuppression();
        }
    }

    /** @param {MouseEvent} event */
    function onContextMenu(event) {
        const target = getTarget(event.target);
        const isCurrentPress = Boolean(target && pressState?.target === target);
        const isOpenLongPress = Boolean(target && activeMode === MODE.LONG_PRESS && activeTarget === target);

        if (isCurrentPress || isOpenLongPress) {
            event.preventDefault();
            event.stopPropagation();
        }
    }

    /** @param {KeyboardEvent} event */
    function onKeyDown(event) {
        if (event.key === 'Escape' && activeTarget) {
            hideTooltip();
        }
    }

    /** @param {Event} event */
    function onScroll(event) {
        if (event.target instanceof Node && tooltip.contains(event.target)) {
            return;
        }

        cancelPress();
        if (activeTarget) {
            hideTooltip();
        }
    }

    function onViewportChange() {
        if (activeTarget) {
            queuePosition();
        }
    }

    const observer = new MutationObserver((mutations) => {
        if (!activeTarget) {
            return;
        }
        if (!activeTarget.isConnected) {
            hideTooltip();
            return;
        }

        let targetChanged = false;
        let layoutChanged = false;
        for (const mutation of mutations) {
            if (mutation.target instanceof Node && tooltip.contains(mutation.target)) {
                continue;
            }

            const mutationInsideTarget = mutation.target === activeTarget
                || (mutation.target instanceof Node && activeTarget.contains(mutation.target));
            const mutationAroundTarget = mutation.type === 'childList'
                && mutation.target instanceof Node
                && mutation.target.contains(activeTarget);
            targetChanged ||= mutationInsideTarget;
            layoutChanged ||= mutationInsideTarget || mutationAroundTarget;
        }

        if (targetChanged) {
            const currentText = getFullText(activeTarget);
            if (!currentText) {
                hideTooltip();
                return;
            }
            if (tooltip.textContent !== currentText) {
                tooltip.textContent = currentText;
            }
        }
        if (layoutChanged) {
            queuePosition();
        }
    });

    const resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            if (activeTarget) {
                queuePosition();
            }
        })
        : null;

    document.addEventListener('pointerover', onPointerOver, { signal });
    document.addEventListener('pointerout', onPointerOut, { signal });
    document.addEventListener('focusin', onFocusIn, { signal });
    document.addEventListener('focusout', onFocusOut, { signal });
    document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true, signal });
    document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true, signal });
    document.addEventListener('pointerup', onPointerUp, { capture: true, signal });
    document.addEventListener('pointercancel', onPointerCancel, { capture: true, signal });
    document.addEventListener('click', onClick, { capture: true, signal });
    document.addEventListener('contextmenu', onContextMenu, { capture: true, signal });
    document.addEventListener('keydown', onKeyDown, { signal });
    document.addEventListener('scroll', onScroll, { capture: true, passive: true, signal });
    tooltip.addEventListener('pointerenter', onTooltipPointerEnter, { signal });
    tooltip.addEventListener('pointerleave', onTooltipPointerLeave, { signal });
    window.addEventListener('resize', onViewportChange, { passive: true, signal });
    window.addEventListener('blur', onScroll, { passive: true, signal });
    window.addEventListener('pagehide', onScroll, { passive: true, signal });
    window.visualViewport?.addEventListener('resize', onViewportChange, { passive: true, signal });
    window.visualViewport?.addEventListener('scroll', onViewportChange, { passive: true, signal });

    const api = {
        destroy() {
            abortController.abort();
            observer.disconnect();
            resizeObserver?.disconnect();
            cancelPress();
            clearClickSuppression();
            hideTooltip();
            tooltip.remove();

            if (globalThis[INSTANCE_KEY] === api) {
                delete globalThis[INSTANCE_KEY];
            }
        },
    };

    return api;
}

/**
 * SillyTavern extension activation hook.
 */
export function onActivate() {
    globalThis[INSTANCE_KEY]?.destroy?.();
    globalThis[INSTANCE_KEY] = createController();
    console.info('[Additional Info Tooltips] Ready.');
}

/**
 * SillyTavern extension disable hook.
 */
export function onDisable() {
    globalThis[INSTANCE_KEY]?.destroy?.();
}
