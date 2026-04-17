"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import {
  useDashboard,
  timeAgo,
  type ChartPoint,
  type TopCard,
  type AgingBucket,
} from "@/hooks/use-dashboard";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type Period = "7D" | "30D" | "90D";
type ChartType = "area" | "bar";

export default function DashboardPage() {
  const { user } = useAuth();
  const d = useDashboard(user?.id);
  const [period, setPeriod] = useState<Period>("30D");
  const [chartType, setChartType] = useState<ChartType>("area");

  const chartData =
    period === "7D"
      ? d.chartData7d
      : period === "30D"
      ? d.chartData30d
      : d.chartData90d;

  return (
    <div className="px-4 pt-6 space-y-4">
      {/* 1. Header: KardVault logo + PRO badge */}
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">
          <span className="text-text-primary">Kad</span>
          <span className="text-primary-400">Vault</span>
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href="/storefront"
            className="flex items-center justify-center w-9 h-9 rounded-full bg-bg-surface border border-border-default"
            aria-label="Storefront"
          >
            <svg className="w-4.5 h-4.5 text-text-secondary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
            </svg>
          </Link>
          <span className="text-xs font-medium text-badge-text bg-badge-bg px-2.5 py-1 rounded-full">
            PRO
          </span>
        </div>
      </header>

      {d.loading ? (
        <div className="bg-bg-surface rounded-xl p-4">
          <p className="text-text-muted text-sm text-center py-12">
            Loading dashboard...
          </p>
        </div>
      ) : (
        <>
          {/* 2. Stats row (3-column): Inventory, Market value, Cards sold */}
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              label="Inventory"
              value={String(d.inventoryCount)}
              delta={d.inventoryDelta}
            />
            <StatCard
              label="Market Value"
              value={`RM ${d.marketValue.toFixed(0)}`}
              delta={d.marketValueDelta}
            />
            <StatCard
              label="Sold"
              value={String(d.cardsSoldThisMonth)}
              delta={d.cardsSoldDelta}
            />
          </div>

          {/* 3. Revenue chart card */}
          <div className="bg-bg-surface rounded-xl p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <p className="text-text-primary text-2xl font-bold">
                  RM {d.revenueThisMonth.toFixed(0)}
                </p>
                <p className="text-text-secondary text-xs">Revenue this month</p>
              </div>
              {/* Chart type toggle */}
              <div className="flex gap-1 bg-bg-surface-2 rounded-lg p-0.5">
                <button
                  onClick={() => setChartType("area")}
                  className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                    chartType === "area"
                      ? "bg-primary-800 text-primary-50"
                      : "text-text-muted"
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2 20 7 10l5 6 4-8 6 4" />
                  </svg>
                </button>
                <button
                  onClick={() => setChartType("bar")}
                  className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                    chartType === "bar"
                      ? "bg-primary-800 text-primary-50"
                      : "text-text-muted"
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 21V12h4v9m4 0V8h4v13m4 0V4h4v17" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Period toggle tabs */}
            <div className="flex gap-1 mb-3">
              {(["7D", "30D", "90D"] as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors ${
                    period === p
                      ? "bg-primary-400 text-text-on-primary"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Chart */}
            <RevenueChart data={chartData} type={chartType} />
          </div>

          {/* 4. Profit row (2-column): Total profit + avg margin, Avg sell price */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-bg-surface rounded-xl p-3">
              <p className="text-text-muted text-[10px] uppercase tracking-wide mb-0.5">
                Total Profit
              </p>
              <p
                className={`text-xl font-bold ${
                  d.totalProfit >= 0 ? "text-success" : "text-danger"
                }`}
              >
                {d.totalProfit >= 0 ? "+" : ""}RM {d.totalProfit.toFixed(0)}
              </p>
              {d.avgMarginPct != null && (
                <p className="text-text-secondary text-[11px] mt-0.5">
                  {d.avgMarginPct.toFixed(0)}% avg margin
                </p>
              )}
            </div>
            <div className="bg-bg-surface rounded-xl p-3">
              <p className="text-text-muted text-[10px] uppercase tracking-wide mb-0.5">
                Avg Sell Price
              </p>
              <p className="text-text-primary text-xl font-bold">
                {d.avgSellPrice != null
                  ? `RM ${d.avgSellPrice.toFixed(0)}`
                  : "—"}
              </p>
              <p className="text-text-secondary text-[11px] mt-0.5">per card</p>
            </div>
          </div>

          {/* 5. Recent sales list */}
          <div>
            <h2 className="text-text-secondary text-xs font-medium uppercase tracking-wide mb-2">
              Recent Sales
            </h2>
            {d.recentSales.length === 0 ? (
              <div className="bg-bg-surface rounded-xl p-4">
                <p className="text-text-muted text-sm text-center py-6">
                  No sales yet. Sell a card from your inventory to see it here.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {d.recentSales.map((sale) => {
                  const profit =
                    sale.market_price_at_time != null
                      ? (sale.price_rm - sale.market_price_at_time) * sale.quantity
                      : null;

                  return (
                    <div
                      key={sale.id}
                      className="flex items-center gap-3 bg-bg-surface rounded-xl p-3"
                    >
                      {sale.card?.image_small ? (
                        <img
                          src={sale.card.image_small}
                          alt={sale.card.name}
                          className="w-9 h-[50px] rounded object-cover bg-bg-surface-2 shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-[50px] rounded bg-bg-surface-2 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-text-primary text-sm font-medium truncate">
                          {sale.card?.name ?? "Unknown"}
                        </p>
                        <p className="text-text-muted text-[11px]">
                          {sale.card?.set_name} · {timeAgo(sale.created_at)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-text-primary text-sm font-medium">
                          RM {(sale.price_rm * sale.quantity).toFixed(2)}
                        </p>
                        {profit != null && (
                          <p
                            className={`text-[11px] font-medium ${
                              profit >= 0 ? "text-success" : "text-danger"
                            }`}
                          >
                            {profit >= 0 ? "+" : ""}RM {profit.toFixed(2)}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 6. Inventory aging bar */}
          {d.agingBuckets.some((b) => b.count > 0) && (
            <div>
              <h2 className="text-text-secondary text-xs font-medium uppercase tracking-wide mb-2">
                Inventory Aging
              </h2>
              <InventoryAgingBar buckets={d.agingBuckets} />
            </div>
          )}

          {/* 7. Best performers grid (2×2) */}
          {(d.highestMarginCard || d.mostSoldCard || d.longestHeldCard || d.biggestPriceRise) && (
            <div>
              <h2 className="text-text-secondary text-xs font-medium uppercase tracking-wide mb-2">
                Best Performers
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {d.highestMarginCard && (
                  <PerformerCard
                    label="Highest Margin"
                    card={d.highestMarginCard}
                    color="text-success"
                  />
                )}
                {d.mostSoldCard && (
                  <PerformerCard
                    label="Most Sold"
                    card={d.mostSoldCard}
                    color="text-info"
                  />
                )}
                {d.longestHeldCard && (
                  <PerformerCard
                    label="Longest Held"
                    card={d.longestHeldCard}
                    color="text-warning"
                  />
                )}
                {d.biggestPriceRise && (
                  <PerformerCard
                    label="Biggest Rise"
                    card={d.biggestPriceRise}
                    color="text-success"
                  />
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// --- Sub-components ---

function StatCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta: number | null;
}) {
  return (
    <div className="bg-bg-surface rounded-xl p-2.5">
      <p className="text-text-muted text-[10px] uppercase tracking-wide">
        {label}
      </p>
      <p className="text-text-primary text-sm font-semibold">{value}</p>
      {delta != null && delta !== 0 && (
        <p
          className={`text-[10px] font-medium mt-0.5 ${
            delta > 0 ? "text-success" : "text-danger"
          }`}
        >
          {delta > 0 ? "▲" : "▼"} {Math.abs(delta)} vs last week
        </p>
      )}
    </div>
  );
}

function RevenueChart({
  data,
  type,
}: {
  data: ChartPoint[];
  type: ChartType;
}) {
  if (data.length === 0 || data.every((d) => d.revenue === 0)) {
    return (
      <div className="h-[180px] flex items-center justify-center">
        <p className="text-text-muted text-sm">No revenue data yet</p>
      </div>
    );
  }

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-xs shadow-lg">
        <p className="text-text-secondary">{label}</p>
        <p className="text-text-primary font-medium">
          RM {payload[0].value.toFixed(2)}
        </p>
      </div>
    );
  };

  const tickCount = data.length <= 7 ? data.length : data.length <= 30 ? 6 : 5;
  const interval = Math.max(0, Math.floor(data.length / tickCount) - 1);

  if (type === "bar") {
    return (
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data}>
          <XAxis
            dataKey="date"
            tick={{ fill: "#5A586A", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval={interval}
          />
          <YAxis hide />
          <Tooltip content={<CustomTooltip />} cursor={false} />
          <Bar dataKey="revenue" fill="#7C6BB5" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="violetGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7C6BB5" stopOpacity={0.6} />
            <stop offset="40%" stopColor="#7C6BB5" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#0D0C12" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tick={{ fill: "#5A586A", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          interval={interval}
        />
        <YAxis hide />
        <Tooltip content={<CustomTooltip />} cursor={false} />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke="#7C6BB5"
          strokeWidth={2}
          fill="url(#violetGradient)"
          dot={false}
          activeDot={{
            r: 5,
            fill: "#7C6BB5",
            stroke: "#E4DFF0",
            strokeWidth: 2,
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function InventoryAgingBar({ buckets }: { buckets: AgingBucket[] }) {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (total === 0) return null;

  return (
    <div className="bg-bg-surface rounded-xl p-3">
      {/* Stacked horizontal bar */}
      <div className="flex h-2.5 rounded-full overflow-hidden mb-3">
        {buckets.map((b) =>
          b.count > 0 ? (
            <div
              key={b.label}
              style={{
                width: `${(b.count / total) * 100}%`,
                backgroundColor: b.color,
              }}
              className="transition-all"
            />
          ) : null
        )}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {buckets.map((b) => (
          <div key={b.label} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: b.color }}
            />
            <span className="text-text-secondary text-[11px]">
              {b.label}{" "}
              <span className="text-text-primary font-medium">{b.count}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PerformerCard({
  label,
  card,
  color,
}: {
  label: string;
  card: TopCard;
  color: string;
}) {
  return (
    <div className="bg-bg-surface rounded-xl p-3">
      <p className="text-text-muted text-[10px] uppercase tracking-wide mb-2">
        {label}
      </p>
      <div className="flex items-center gap-2">
        {card.card.image_small ? (
          <img
            src={card.card.image_small}
            alt={card.card.name}
            className="w-8 h-11 rounded object-cover bg-bg-surface-2 shrink-0"
          />
        ) : (
          <div className="w-8 h-11 rounded bg-bg-surface-2 shrink-0" />
        )}
        <div className="min-w-0">
          <p className="text-text-primary text-xs font-medium truncate">
            {card.card.name}
          </p>
          <p className={`text-xs font-medium ${color}`}>{card.label}</p>
        </div>
      </div>
    </div>
  );
}
