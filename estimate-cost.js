#!/usr/bin/env node

/**
 * Token/Cost Estimation Tool for Development Tasks
 * 
 * Provides realistic estimates based on AI model usage rather than human time
 */

const chalk = require('chalk');

const MODELS = {
  'claude-sonnet': {
    name: 'Claude Sonnet 3.5',
    input_cost_per_1k: 0.003,
    output_cost_per_1k: 0.015,
    context_window: 200000,
    typical_output_ratio: 0.3 // output tokens / input tokens
  },
  'claude-opus': {
    name: 'Claude Opus',
    input_cost_per_1k: 0.015,
    output_cost_per_1k: 0.075,
    context_window: 200000,
    typical_output_ratio: 0.4
  },
  'gpt-4': {
    name: 'GPT-4',
    input_cost_per_1k: 0.03,
    output_cost_per_1k: 0.06,
    context_window: 128000,
    typical_output_ratio: 0.35
  },
  'gpt-4-turbo': {
    name: 'GPT-4 Turbo',
    input_cost_per_1k: 0.01,
    output_cost_per_1k: 0.03,
    context_window: 128000,
    typical_output_ratio: 0.35
  }
};

const TASK_TEMPLATES = {
  'documentation': {
    description: 'Writing documentation (README, guides, API docs)',
    typical_input_tokens: 5000,
    estimated_output_tokens: 3000,
    iterations: 2
  },
  'bug-fix': {
    description: 'Fixing a bug (analysis, code changes, testing)',
    typical_input_tokens: 8000,
    estimated_output_tokens: 2500,
    iterations: 3
  },
  'feature-small': {
    description: 'Small feature (new script, minor enhancement)',
    typical_input_tokens: 10000,
    estimated_output_tokens: 4000,
    iterations: 3
  },
  'feature-medium': {
    description: 'Medium feature (API changes, new component)',
    typical_input_tokens: 15000,
    estimated_output_tokens: 7000,
    iterations: 4
  },
  'feature-large': {
    description: 'Large feature (major component, complex logic)',
    typical_input_tokens: 25000,
    estimated_output_tokens: 12000,
    iterations: 5
  },
  'testing': {
    description: 'Writing tests (unit tests, integration tests)',
    typical_input_tokens: 6000,
    estimated_output_tokens: 4000,
    iterations: 2
  },
  'refactoring': {
    description: 'Code refactoring (cleanup, optimization)',
    typical_input_tokens: 12000,
    estimated_output_tokens: 8000,
    iterations: 3
  },
  'ci-setup': {
    description: 'CI/CD setup (GitHub Actions, testing pipeline)',
    typical_input_tokens: 8000,
    estimated_output_tokens: 3500,
    iterations: 3
  }
};

function estimateCost(taskType, model = 'claude-sonnet', customParams = {}) {
  const task = TASK_TEMPLATES[taskType];
  const modelConfig = MODELS[model];
  
  if (!task || !modelConfig) {
    throw new Error(`Unknown task type '${taskType}' or model '${model}'`);
  }

  const inputTokens = customParams.inputTokens || task.typical_input_tokens;
  const outputTokens = customParams.outputTokens || task.estimated_output_tokens;
  const iterations = customParams.iterations || task.iterations;

  const totalInputTokens = inputTokens * iterations;
  const totalOutputTokens = outputTokens * iterations;

  const inputCost = (totalInputTokens / 1000) * modelConfig.input_cost_per_1k;
  const outputCost = (totalOutputTokens / 1000) * modelConfig.output_cost_per_1k;
  const totalCost = inputCost + outputCost;

  return {
    task: task.description,
    model: modelConfig.name,
    tokens: {
      input: totalInputTokens,
      output: totalOutputTokens,
      total: totalInputTokens + totalOutputTokens
    },
    cost: {
      input: inputCost,
      output: outputCost,
      total: totalCost
    },
    iterations,
    humanTimeEquivalent: estimateHumanTime(taskType)
  };
}

function estimateHumanTime(taskType) {
  const timeEstimates = {
    'documentation': '2-4 hours',
    'bug-fix': '1-8 hours (varies by complexity)',
    'feature-small': '4-8 hours',
    'feature-medium': '1-3 days',
    'feature-large': '3-7 days',
    'testing': '2-6 hours',
    'refactoring': '4-12 hours',
    'ci-setup': '2-6 hours'
  };
  return timeEstimates[taskType] || 'Unknown';
}

function formatEstimate(estimate) {
  console.log(chalk.blue.bold(`\n📊 Cost Estimation: ${estimate.task}`));
  console.log(chalk.gray(`Model: ${estimate.model}`));
  console.log(chalk.gray(`Iterations: ${estimate.iterations}\n`));

  console.log(chalk.yellow('🔢 Token Usage:'));
  console.log(`  Input tokens:  ${estimate.tokens.input.toLocaleString()}`);
  console.log(`  Output tokens: ${estimate.tokens.output.toLocaleString()}`);
  console.log(`  Total tokens:  ${estimate.tokens.total.toLocaleString()}\n`);

  console.log(chalk.green('💰 Cost Breakdown:'));
  console.log(`  Input cost:  $${estimate.cost.input.toFixed(4)}`);
  console.log(`  Output cost: $${estimate.cost.output.toFixed(4)}`);
  console.log(chalk.green.bold(`  Total cost:  $${estimate.cost.total.toFixed(4)}\n`));

  console.log(chalk.blue('⏱️  Human Equivalent:'));
  console.log(`  Estimated time: ${estimate.humanTimeEquivalent}`);
  console.log(`  Cost comparison: $${estimate.cost.total.toFixed(2)} vs $${estimateHumanCost(estimate.humanTimeEquivalent)}\n`);
}

function estimateHumanCost(timeRange) {
  // Rough estimate: $50/hour developer rate
  const hourlyRate = 50;
  const avgHours = timeRange.includes('days') ? 
    parseInt(timeRange) * 8 : 
    parseFloat(timeRange.split('-')[0]) || 4;
  return (avgHours * hourlyRate).toFixed(0);
}

function showAvailableTasks() {
  console.log(chalk.blue.bold('📋 Available Task Types:\n'));
  
  Object.entries(TASK_TEMPLATES).forEach(([key, task]) => {
    console.log(chalk.yellow(`${key.padEnd(15)} - ${task.description}`));
  });
  
  console.log(chalk.blue.bold('\n🤖 Available Models:\n'));
  
  Object.entries(MODELS).forEach(([key, model]) => {
    console.log(chalk.cyan(`${key.padEnd(15)} - ${model.name} ($${model.input_cost_per_1k}/$${model.output_cost_per_1k} per 1K tokens)`));
  });
}

// CLI Interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(chalk.blue.bold('🧮 Token/Cost Estimation Tool\n'));
    console.log('Usage: node estimate-cost.js <task-type> [model] [options]\n');
    console.log('Examples:');
    console.log('  node estimate-cost.js documentation');
    console.log('  node estimate-cost.js feature-small claude-opus');
    console.log('  node estimate-cost.js bug-fix gpt-4-turbo\n');
    showAvailableTasks();
    process.exit(0);
  }

  if (args[0] === '--list' || args[0] === '-l') {
    showAvailableTasks();
    process.exit(0);
  }

  const taskType = args[0];
  const model = args[1] || 'claude-sonnet';
  
  try {
    const estimate = estimateCost(taskType, model);
    formatEstimate(estimate);
    
    // Show comparison with other models
    if (args.includes('--compare')) {
      console.log(chalk.blue.bold('🔄 Model Comparison:\n'));
      
      Object.keys(MODELS).forEach(modelKey => {
        if (modelKey !== model) {
          const compareEstimate = estimateCost(taskType, modelKey);
          console.log(`${MODELS[modelKey].name.padEnd(20)} $${compareEstimate.cost.total.toFixed(4)}`);
        }
      });
    }
    
  } catch (error) {
    console.error(chalk.red(`❌ Error: ${error.message}`));
    console.log('\nRun with --help to see available options.');
    process.exit(1);
  }
}

module.exports = { estimateCost, MODELS, TASK_TEMPLATES };