/* Starter content for the question bank, seeded once on first boot (when the
   categories table is empty). Hosts pick from these when building a quiz;
   admins can add more later through the admin panel. */
export const QUESTION_BANK_SEED = [
  {
    category: "Contact Center Industry",
    questions: [
      { q: "What does FCR measure?", t: 20, opts: ["Calls resolved on the first contact", "Average time in queue", "Forecast accuracy", "Agents on shift"], correct: 0 },
      { q: "CSAT and NPS measure the same thing.", t: 10, opts: ["True", "False"], correct: 1 },
      { q: "A service level of 80/20 means what?", t: 20, opts: ["80% of contacts answered within 20 seconds", "80 agents per 20 queues", "80% occupancy over 20 minutes", "20% abandon rate allowed"], correct: 0 },
      { q: "Which metric goes UP when handle time is cut too aggressively?", t: 20, opts: ["Repeat contact rate", "Forecast accuracy", "Schedule adherence", "Occupancy"], correct: 0 },
      { q: "Shrinkage in workforce planning refers to…", t: 20, opts: ["Paid time agents are not available to take contacts", "The drop in volume after a campaign", "Reduction in average order value", "Attrition in the first 90 days"], correct: 0 },
      { q: "In COPC terms, a 'critical to quality' item is defined by the client.", t: 10, opts: ["True", "False"], correct: 0 },
      { q: "Occupancy of 95% sustained over a week most likely leads to…", t: 20, opts: ["Burnout and higher attrition", "Better quality scores", "Lower shrinkage", "Improved forecast accuracy"], correct: 0 },
      { q: "Which one is a leading indicator rather than a lagging one?", t: 20, opts: ["Quality monitoring scores", "Monthly CSAT", "Quarterly attrition", "Annual client survey"], correct: 0 },
      { q: "What does AHT stand for?", t: 15, opts: ["Average Handle Time", "Average Hold Time", "Agent Handling Total", "Average Hourly Throughput"], correct: 0 },
      { q: "In workforce management, Erlang C is used to…", t: 20, opts: ["Forecast staffing needs from call volume and patterns", "Calculate agent salaries", "Measure customer satisfaction", "Schedule annual leave"], correct: 0 },
      { q: "A blended contact center handles more than one channel or interaction type.", t: 10, opts: ["True", "False"], correct: 0 }
    ]
  },
  {
    category: "Customer Experience",
    questions: [
      { q: "What does NPS stand for?", t: 15, opts: ["Net Promoter Score", "New Purchase Survey", "Network Performance Score", "National Pricing Standard"], correct: 0 },
      { q: "CSAT measures…", t: 20, opts: ["Satisfaction with a specific interaction or experience", "Overall company revenue", "Employee turnover rate", "Website loading speed"], correct: 0 },
      { q: "CES, or Customer Effort Score, measures…", t: 20, opts: ["How easy it was for a customer to get their issue resolved", "How much a customer spent", "How many channels a customer used", "How long an agent has worked there"], correct: 0 },
      { q: "Omnichannel means offering connected channels that share context, unlike multichannel.", t: 10, opts: ["True", "False"], correct: 0 },
      { q: "What is a 'customer journey map'?", t: 20, opts: ["A visual map of the steps a customer takes interacting with a company", "A map of office floor plans", "A pricing chart", "A staff org chart"], correct: 0 },
      { q: "Which of these is a self-service channel?", t: 20, opts: ["Knowledge base / FAQ", "Voice call with an agent", "Live chat with an agent", "In-person visit"], correct: 0 },
      { q: "A high NPS score guarantees zero customer churn.", t: 10, opts: ["True", "False"], correct: 1 },
      { q: "Personalization in CX typically relies on…", t: 20, opts: ["Customer data and behavior history", "Random selection", "Government regulation", "Agent guesswork"], correct: 0 },
      { q: "Which metric is typically captured right after a single support interaction?", t: 15, opts: ["CSAT", "Annual revenue", "Employee headcount", "Market share"], correct: 0 },
      { q: "Reducing effort for the customer generally correlates with higher loyalty.", t: 10, opts: ["True", "False"], correct: 0 }
    ]
  },
  {
    category: "Foundever",
    questions: [
      { q: "Foundever was formerly known as Sitel Group before its 2023 rebrand.", t: 10, opts: ["True", "False"], correct: 0 },
      { q: "What kind of company is Foundever?", t: 20, opts: ["A global customer experience (CX) outsourcing / BPO company", "An airline", "A smartphone manufacturer", "A national postal service"], correct: 0 },
      { q: "Foundever provides customer support services on behalf of other companies' brands.", t: 10, opts: ["True", "False"], correct: 0 },
      { q: "What industry does Foundever primarily operate in?", t: 20, opts: ["Business process outsourcing / customer experience", "Oil and gas extraction", "Commercial banking", "Film production"], correct: 0 },
      { q: "Foundever operates contact centers in multiple countries around the world.", t: 10, opts: ["True", "False"], correct: 0 },
      { q: "What are the front-line employees who handle customer interactions commonly called?", t: 20, opts: ["Agents / associates", "Volunteers", "Interns only", "Board members"], correct: 0 }
    ]
  }
];
