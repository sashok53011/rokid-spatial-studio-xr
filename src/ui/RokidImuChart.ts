import React from 'react';
import {createRoot, Root} from 'react-dom/client';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {RokidWebHIDState} from '../types.ts';

export type ImuChartChannel = 'euler' | 'gyro' | 'accel';

interface ImuSamplePoint {
  t: number;
  v1: number;
  v2: number;
  v3: number;
}

const MAX_POINTS = 36;

export class RokidImuChart {
  readonly element: HTMLDivElement;
  private chartMount: HTMLDivElement;
  private root: Root;
  private channel: ImuChartChannel = 'euler';
  private samples: ImuSamplePoint[] = [];
  private sampleIndex = 0;
  private lastRenderMs = 0;
  private channelButtons = new Map<ImuChartChannel, HTMLButtonElement>();
  private legendLabels: [HTMLSpanElement, HTMLSpanElement, HTMLSpanElement];
  private latestState: RokidWebHIDState | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'rokid-imu-chart-wrap';

    const header = document.createElement('div');
    header.className = 'rokid-imu-chart-header';

    const modeGroup = document.createElement('div');
    modeGroup.className = 'rokid-imu-mode-group';

    const modes: {id: ImuChartChannel; label: string}[] = [
      {id: 'euler', label: 'Euler °'},
      {id: 'gyro', label: 'Gyro °/s'},
      {id: 'accel', label: 'Accel'},
    ];
    for (const m of modes) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rokid-imu-mode-btn';
      btn.textContent = m.label;
      btn.addEventListener('click', () => this.setChannel(m.id));
      this.channelButtons.set(m.id, btn);
      modeGroup.appendChild(btn);
    }

    const legend = document.createElement('div');
    legend.className = 'rokid-imu-legend';
    const colors = ['#38bdf8', '#a855f7', '#34d399'];
    const spans: HTMLSpanElement[] = [];
    for (let i = 0; i < 3; i++) {
      const item = document.createElement('span');
      item.className = 'rokid-imu-legend-item';
      item.style.color = colors[i];
      legend.appendChild(item);
      spans.push(item);
    }
    this.legendLabels = [spans[0], spans[1], spans[2]];

    header.append(modeGroup, legend);

    this.chartMount = document.createElement('div');
    this.chartMount.className = 'rokid-imu-chart-canvas';

    this.element.append(header, this.chartMount);
    this.root = createRoot(this.chartMount);

    // Seed baseline samples so axes and grid render cleanly before packets arrive
    for (let i = 0; i < MAX_POINTS; i++) {
      this.samples.push({t: i, v1: 0, v2: 0, v3: 0});
      this.sampleIndex = i + 1;
    }

    this.syncChannelUI();
    this.renderChart();
  }

  setChannel(channel: ImuChartChannel): void {
    if (this.channel === channel) return;
    this.channel = channel;
    this.samples = [];
    for (let i = 0; i < MAX_POINTS; i++) {
      const base = this.latestState
        ? this.extractSample(this.latestState)
        : {v1: 0, v2: 0, v3: 0};
      this.samples.push({t: this.sampleIndex++, ...base});
    }
    this.syncChannelUI();
    this.renderChart();
  }

  private syncChannelUI(): void {
    for (const [id, btn] of this.channelButtons.entries()) {
      btn.classList.toggle('active', id === this.channel);
    }
    const labels =
      this.channel === 'euler'
        ? ['Yaw', 'Pitch', 'Roll']
        : this.channel === 'gyro'
          ? ['Gx', 'Gy', 'Gz']
          : ['Ax', 'Ay', 'Az'];
    this.legendLabels.forEach((el, idx) => {
      el.textContent = labels[idx];
    });
  }

  private extractSample(state: RokidWebHIDState): {
    v1: number;
    v2: number;
    v3: number;
  } {
    if (this.channel === 'euler') {
      return {v1: state.yawDeg, v2: state.pitchDeg, v3: state.rollDeg};
    }
    if (this.channel === 'gyro') {
      return {v1: state.gyroX, v2: state.gyroY, v3: state.gyroZ};
    }
    return {v1: state.accelX, v2: state.accelY, v3: state.accelZ};
  }

  pushSample(state: RokidWebHIDState): void {
    this.latestState = state;
    if (state.status !== 'connected') return;

    const now = performance.now();
    if (now - this.lastRenderMs < 50) return;
    this.lastRenderMs = now;

    const next = this.extractSample(state);
    this.samples = [
      ...this.samples.slice(-(MAX_POINTS - 1)),
      {t: this.sampleIndex++, ...next},
    ];
    this.renderChart();
  }

  private getSeriesNames(): [string, string, string] {
    if (this.channel === 'euler') return ['Yaw (°)', 'Pitch (°)', 'Roll (°)'];
    if (this.channel === 'gyro') return ['Gx (°/s)', 'Gy (°/s)', 'Gz (°/s)'];
    return ['Ax (m/s²)', 'Ay (m/s²)', 'Az (m/s²)'];
  }

  private renderChart(): void {
    const [n1, n2, n3] = this.getSeriesNames();
    const yDomain: [number | 'auto', number | 'auto'] =
      this.channel === 'euler'
        ? [-180, 180]
        : this.channel === 'accel'
          ? [-20, 20]
          : ['auto', 'auto'];

    const lineChart = React.createElement(
      LineChart,
      {
        data: this.samples,
        margin: {top: 4, right: 6, left: -24, bottom: 0},
      },
      React.createElement(CartesianGrid, {
        stroke: 'rgba(148, 163, 184, 0.16)',
        strokeDasharray: '2 2',
        vertical: false,
      }),
      React.createElement(XAxis, {
        dataKey: 't',
        hide: true,
      }),
      React.createElement(YAxis, {
        domain: yDomain,
        tick: {fill: '#94a3b8', fontSize: 10},
        axisLine: false,
        tickLine: false,
        width: 48,
      }),
      React.createElement(Tooltip, {
        contentStyle: {
          backgroundColor: 'rgba(10, 15, 28, 0.94)',
          border: '1px solid rgba(56, 189, 248, 0.35)',
          borderRadius: 8,
          fontSize: 11,
          padding: '4px 8px',
        },
        labelStyle: {display: 'none'},
      }),
      React.createElement(Line, {
        type: 'monotone',
        dataKey: 'v1',
        name: n1,
        stroke: '#38bdf8',
        strokeWidth: 1.8,
        dot: false,
        isAnimationActive: false,
      }),
      React.createElement(Line, {
        type: 'monotone',
        dataKey: 'v2',
        name: n2,
        stroke: '#a855f7',
        strokeWidth: 1.8,
        dot: false,
        isAnimationActive: false,
      }),
      React.createElement(Line, {
        type: 'monotone',
        dataKey: 'v3',
        name: n3,
        stroke: '#34d399',
        strokeWidth: 1.8,
        dot: false,
        isAnimationActive: false,
      })
    );

    const chart = React.createElement(ResponsiveContainer, {
      width: '100%',
      height: 112,
      children: lineChart,
    });

    this.root.render(chart);
  }

  dispose(): void {
    this.root.unmount();
    this.element.remove();
  }
}
