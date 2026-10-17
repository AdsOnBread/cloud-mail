
import * as echarts from 'echarts/core';

import { BarChart,PieChart,LineChart,GaugeChart} from 'echarts/charts';
// Import chart titles, tooltips, grids, datasets, and data transforms
import {
    TooltipComponent,
    GridComponent,
} from 'echarts/components';
// Automatic label layout and chart transitions
// Import a renderer; ECharts requires CanvasRenderer or SVGRenderer
import { CanvasRenderer } from 'echarts/renderers';
import { LegendComponent } from 'echarts/components';
// Register the required components
echarts.use([
    GaugeChart,
    LegendComponent,
    PieChart,
    TooltipComponent,
    GridComponent,
    BarChart,
    LineChart,
    CanvasRenderer
]);

export default echarts