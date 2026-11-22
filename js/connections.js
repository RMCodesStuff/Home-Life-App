// The user's other apps that Home Life reads from (read-only). Firebase web configs identify a project and are public by
// design (they ship in every page of those apps); who can read what is decided by each project's security rules.

export const FIREBASE = {
  // the meal planner (recipe-planner-bcd94), same config its own web app ships
  meals: {
    apiKey: 'AIzaSyB4g-0dTKb76_e7-b_mvUibppnwSlXcPQk',
    authDomain: 'recipe-planner-bcd94.firebaseapp.com',
    projectId: 'recipe-planner-bcd94',
    storageBucket: 'recipe-planner-bcd94.firebasestorage.app',
    messagingSenderId: '21222251746',
    appId: '1:21222251746:web:801773bc5d490a3bf512bb',
  },
  // the rack session timer (workout-app-21b1d)
  rack: {
    apiKey: 'AIzaSyDCVMWMmRbwVF4_Wm57hzpm_Yg8AIQ6p80',
    authDomain: 'workout-app-21b1d.firebaseapp.com',
    projectId: 'workout-app-21b1d',
    storageBucket: 'workout-app-21b1d.firebasestorage.app',
    messagingSenderId: '541959459504',
    appId: '1:541959459504:web:49e99825261e6111352175',
  },
};

/** The meal planner's shared household in Firestore. */
export const MEAL_BASE = 'artifacts/fresh-meal-planner-app/households/main';
export const mealPlanPath = () => `${MEAL_BASE}/mealPlans/currentWeek`;
export const recipePath = (id) => `${MEAL_BASE}/recipes/${id}`;
/** The rack timer's per-user document; its `homelife` field is the summary (contract v1). */
export const rackUserPath = (uid) => `users/${uid}`;
/** Same origin as Home Life on GitHub Pages, so the timer's localStorage summary is readable here. */
export const RACK_LOCAL_KEY = 'rst.homelife';

export const LINKS = {
  mealPlan: 'https://recipe-planner-bcd94.web.app/',
  rackTimer: '../rack-session-timer/',
};
