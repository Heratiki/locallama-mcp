import { costMonitor } from '../../cost-monitor/index.js';
import { ICostEstimator } from '../types.js';

export class CostEstimator implements ICostEstimator {
  async estimateCost(contextLength: number, expectedOutputLength: number): Promise<number> {
    const estimate = await costMonitor.estimateCost({
      contextLength,
      outputLength: expectedOutputLength,
    });
    return estimate.paid.cost.total;
  }
}

const costEstimator = new CostEstimator();

export { costEstimator };
export const estimateCost = costEstimator.estimateCost.bind(costEstimator);

