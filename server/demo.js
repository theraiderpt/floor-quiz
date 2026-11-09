/* The quiz /demo runs: short, light, and one of each question type, so a
   visitor sees every kind of screen in about five minutes. */
export const DEMO_QUIZ = {
  title: "CX Quiz demo",
  questions: [
    { type: "single", q: "What does CX stand for?", t: 20,
      opts: ["Customer Experience", "Coffee Express", "Call Exchange", "Cool Extras"], correct: 0 },
    { type: "multi", q: "Which of these are real customer contact channels? Pick all that apply.", t: 25,
      opts: ["Phone", "Live chat", "Email", "Carrier pigeon"], correct: [0, 1, 2] },
    { type: "numeric", q: "How many minutes are there in an 8-hour shift?", t: 20, target: 480, tolerance: 0 },
    { type: "single", q: "\"First contact resolution\" means the customer's issue is…", t: 20, shuffle: true,
      opts: ["Solved in a single contact", "Answered within one minute", "Handled by the first agent free", "Logged before lunch"], correct: 0 },
    { type: "text", q: "In one word: what makes a great customer conversation?", t: 30 },
    { type: "single", q: "Which planet is closest to the Sun?", t: 15, shuffle: true,
      opts: ["Mercury", "Venus", "Earth", "Mars"], correct: 0 }
  ]
};
