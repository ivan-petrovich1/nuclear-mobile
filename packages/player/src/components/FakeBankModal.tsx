import { Landmark, Skull, X } from 'lucide-react';
import { FC, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { haptic } from '../services/androidMediaBridge';

const INTEREST_RATE_DISPLAY = '1,000,000,000%';

type FakeLoanState = {
  principal: number;
  borrowedAtMs: number | null;
  loansTaken: number;
  bankruptcies: number;
  reason: string;
  takeLoan: (amount: number, reason: string) => void;
  declareBankruptcy: () => void;
};

export const useFakeLoanStore = create<FakeLoanState>()(
  persist(
    (set) => ({
      principal: 0,
      borrowedAtMs: null,
      loansTaken: 0,
      bankruptcies: 0,
      reason: '',
      takeLoan: (amount, reason) =>
        set((s) => ({
          principal: s.principal + amount,
          borrowedAtMs: s.borrowedAtMs ?? Date.now(),
          loansTaken: s.loansTaken + 1,
          reason,
        })),
      declareBankruptcy: () =>
        set((s) => ({
          principal: 0,
          borrowedAtMs: null,
          bankruptcies: s.bankruptcies + 1,
          reason: '',
        })),
    }),
    { name: 'nuclear-fake-bank-v1' },
  ),
);

const formatAbsurdMoney = (val: number): string => {
  if (!Number.isFinite(val)) {
    return '$∞ (ECONOMIC COLLAPSE)';
  }
  if (val < 1_000_000) {
    return `$${val.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
  const units = [
    'Million',
    'Billion',
    'Trillion',
    'Quadrillion',
    'Quintillion',
    'Sextillion',
    'Septillion',
    'Octillion',
    'Nonillion',
    'Decillion',
  ];
  let idx = -1;
  let scaled = val / 1000;
  while (scaled >= 1000 && idx < units.length - 1) {
    scaled /= 1000;
    idx++;
  }
  if (idx >= 0 && scaled < 1000) {
    return `$${scaled.toFixed(2)} ${units[idx]}`;
  }
  return `$${val.toExponential(2)}`;
};

const LOAN_REASONS = [
  'Gold-plated audiophile AUX cable',
  'Emergency vinyl impulse buy',
  'One (1) concert water bottle',
  'Downloading more RAM',
  'Paying off previous loan from Bank of Penis',
];

export const FakeBankModal: FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const {
    principal,
    borrowedAtMs,
    loansTaken,
    bankruptcies,
    reason,
    takeLoan,
    declareBankruptcy,
  } = useFakeLoanStore();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectedReason, setSelectedReason] = useState(LOAN_REASONS[0]);

  useEffect(() => {
    if (!open || !borrowedAtMs) {
      return;
    }
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [open, borrowedAtMs]);

  if (!open) {
    return null;
  }

  const elapsedSec = borrowedAtMs
    ? Math.max(0, (nowMs - borrowedAtMs) / 1000)
    : 0;
  // 1 billion % APR compounded dramatically for comedic effect
  const currentDebt =
    principal > 0 ? principal * Math.pow(1.42, elapsedSec) : 0;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="border-border bg-background text-foreground w-full max-w-sm space-y-4 rounded-2xl border p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Landmark size={20} className="text-amber-400" />
            <div>
              <h3 className="text-base font-extrabold">Bank of Penis™</h3>
              <div className="text-[10px] opacity-65">
                REAL BANK • REAL MONEY • INTEREST: {INTEREST_RATE_DISPLAY}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full bg-black/20 p-1.5 active:scale-90"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Live Debt Counter */}
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-center">
          <div className="text-[10px] font-bold tracking-wider uppercase opacity-75">
            Your Totally Real Debt
          </div>
          <div className="mt-1 font-mono text-lg font-extrabold break-all text-rose-400">
            {formatAbsurdMoney(currentDebt)}
          </div>
          <div className="mt-1 text-[10px] opacity-70">
            APR: <strong>{INTEREST_RATE_DISPLAY}</strong> • Loans: {loansTaken}{' '}
            • Bankruptcies: {bankruptcies}
          </div>
          {reason && principal > 0 && (
            <div className="mt-1 text-[10px] italic opacity-75">
              Purpose: “{reason}”
            </div>
          )}
        </div>

        {/* Loan Purpose Picker */}
        <div className="space-y-1">
          <label className="text-[11px] font-bold opacity-75">
            Loan Purpose:
          </label>
          <select
            value={selectedReason}
            onChange={(e) => setSelectedReason(e.target.value)}
            className="border-border bg-input text-input-foreground w-full rounded-lg border px-2.5 py-2 text-xs"
          >
            {LOAN_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        {/* Borrow Buttons */}
        <div className="grid grid-cols-2 gap-2 text-xs font-extrabold">
          {[10, 100, 10_000, 1_000_000].map((amt) => (
            <button
              key={amt}
              onClick={() => {
                haptic('medium');
                takeLoan(amt, selectedReason);
                toast.success(
                  `💸 Borrowed $${amt.toLocaleString()} from Bank of Penis™ at ${INTEREST_RATE_DISPLAY} interest!`,
                );
              }}
              className="bg-primary text-primary-foreground rounded-xl py-2.5 shadow transition active:scale-95"
            >
              Borrow ${amt.toLocaleString()}
            </button>
          ))}
        </div>

        {principal > 0 && (
          <button
            onClick={() => {
              haptic('heavy');
              declareBankruptcy();
              toast.info(
                '📉 Bankruptcy declared. Bank of Penis™ has repossessed your bass boost.',
              );
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/20 py-2 text-xs font-extrabold text-rose-300 transition active:scale-95"
          >
            <Skull size={14} /> Declare Bankruptcy (Escape Debt)
          </button>
        )}

        <div className="text-center text-[10px] font-bold tracking-wide opacity-55">
          REAL MONEY • REAL BANK • REAL INTEREST • TRUST US BRO
        </div>
      </div>
    </div>
  );
};
