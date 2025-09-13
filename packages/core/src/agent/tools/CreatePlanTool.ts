import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { IToolConfig } from './types';
import { BaseTool } from './BaseTool';
import { createNetworkSchema } from './schemas';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { CustomDynamicStructuredTool } from './types';
export class CreatePlanTool extends BaseTool {
  getName(): string {
    return 'create_plan';
  }

  getDescription(): string {
    return `Create plan list to execute the user's request. You must break down details of the plan into tasks.`;
  }

  getSchema(): z.ZodObject<any> {
    return z.object({
      plans: z
        .array(
          z.object({
            title: z.string().describe('The title of the plan'),
            tasks: z.array(
              z
                .string()
                .describe(
                  'The tasks description to execute the plan. The task must clear and concise',
                ),
            ),
          }),
        )
        .describe('The plans to execute'),
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
            title: task,
            status: 'pending',
          };
        }),
      };
    });
  }

  private updatePlan(plans: any[]) {
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
        status: args.status,
      }),
    );
  }

  createTool(): CustomDynamicStructuredTool {
    return new DynamicStructuredTool({
      name: this.getName(),
      description: this.getDescription(),
      schema: this.getSchema(),
      func: async ({ command, plans }) => {
        return JSON.stringify(this.createPlan(plans));
      },
    });
  }
}
