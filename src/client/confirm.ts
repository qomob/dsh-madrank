/// <reference lib="dom" />

/**
 * confirm.ts — 通用二次确认弹层（React 组件，Portal 挂 body）。
 *
 * 用途：MADRank 里只有"隐私含义"的动作需要二次确认——加入/退出全球排名。
 * 弹层本身不持有业务状态：确认/取消都由调用方决定，关闭即卸载、无残留。
 */

import { createElement, useEffect } from 'react'
import type { ReactPortal } from 'react'
import { createPortal } from 'react-dom'

export interface ConfirmDialogProps {
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  onConfirm(): void
  onCancel(): void
  /** 覆盖层级（默认 2147483002，高于分享弹层与卡片模态）。 */
  zIndex?: number
}

export function ConfirmDialog(props: ConfirmDialogProps): ReactPortal | null {
  const { title, body, confirmLabel, cancelLabel, onConfirm, onCancel, zIndex } = props

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      onCancel()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  if (typeof document === 'undefined') return null

  const root = createElement('div', {
    className: 'madrank-confirm',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
    style: zIndex === undefined ? undefined : { zIndex: String(zIndex) },
    onClick: (e: { target: unknown; currentTarget: unknown }) => {
      if (e.target === e.currentTarget) onCancel()
    },
  },
  createElement('div', { className: 'madrank-confirm-panel' },
    createElement('h3', { className: 'madrank-confirm-title' }, title),
    createElement('p', { className: 'madrank-confirm-body' }, body),
    createElement('div', { className: 'madrank-confirm-actions' },
      createElement('button', { type: 'button', className: 'madrank-confirm-cancel', onClick: onCancel }, cancelLabel),
      createElement('button', { type: 'button', className: 'madrank-confirm-ok', onClick: onConfirm }, confirmLabel),
    ),
  ))

  return createPortal(root, document.body)
}
