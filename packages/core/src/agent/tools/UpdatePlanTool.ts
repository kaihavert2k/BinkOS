import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { IToolConfig } from './types';
import { BaseTool } from './BaseTool';
import { createNetworkSchema } from './schemas';
import { getCurrentTaskInput, LangGraphRunnableConfig } from '@langchain/langgraph';
import { CustomDynamicStructuredTool } from './types';
export class UpdatePlanTool extends BaseTool {
  getName(): string {
    return 'update_plan';
  }

  getDescription(): string {
    return `Update plan list to execute the user's request`;
  }

  getSchema(): z.ZodObject<any> {
    return z.object({
      plan_id: z.string().describe('The id of the plan'),
      tasks: z
        .array(
          z.object({
            title: z
              .string()
              .optional()
              .describe(
                'The title of the task that need to be updated, if not provided, the task will not be updated',
              ),
            index: z.number().describe('The index of the task that need to be updated'),
            status: z
              .enum(['pending', 'in-progress', 'completed', 'failed'])
              .describe('The status of the task'),
          }),
        )
        .describe('Only update the tasks that need to be updated'),
    });
  }

  private createPlanId() {
    // random 5 characters
    return Math.random().toString(36).substring(2, 7);
  }

  private createPlan(plans: any[]) {
    return plans.map((plan: any) => {
      return {
        plan_id: this.createPlanId(),
        title: plan.title,
        status: 'pending',
        tasks: plan.tasks.map((task: any) => {
          return {
            title: task.title,
            status: 'pending',
          };
        }),
      };
    });
  }

  private updatePlan(plan_id: string, tasks: { title: string; index: number; status: string }[]) {
    const plans = (getCurrentTaskInput() as any).plans;

    const plan = plans.find((plan: any) => plan.plan_id === plan_id);

    if (!plan) {
      throw new Error('Plan not found');
    }

    plan.tasks = plan.tasks.map((task: any, index: number) => {
      const taskToUpdate = tasks.find((task: any) => task.index === index);
      if (taskToUpdate) {
        return {
          title: task.title,
          status: taskToUpdate.status,
        };
      }
      return task;
    });

    return plans.map((plan: any) => {
      //check plan status is completed
      const isPlanCompleted = plan.tasks.every((task: any) => task.status === 'completed');
      // check plan status is in progress
      const isPlanInProgress = plan.tasks.some((task: any) => task.status === 'completed');

      return {
        plan_id: plan.plan_id,
        title: plan.title,
        status: isPlanCompleted ? 'completed' : isPlanInProgress ? 'in-progress' : 'pending',
        tasks: plan.tasks.map((task: any) => {
          return {
            title: task.title,
            status: task.status,
          };
        }),
      };
    });
  }

  mockResponseTool(args: any): Promise<string> {
    return Promise.resolve(
      JSON.stringify({
        plan_id: args.plan_id,
        title: args.title,
        status: args.status,
        tasks: args.tasks.map((task: any) => ({
          title: task.title,
          status: task.status,
        })),
      }),
    );
  }
  createTool(): CustomDynamicStructuredTool {
    return new DynamicStructuredTool({
      name: this.getName(),
      description: this.getDescription(),
      schema: this.getSchema(),
      func: async ({ plan_id, tasks }) => {
        const result = this.updatePlan(plan_id, tasks);
        return JSON.stringify(result);
      },
    });
  }
}
