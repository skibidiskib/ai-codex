export async function load({ params }) {
  return { about: true };
}

export const actions = {
  default: async () => { return { success: true }; },
  contact: async () => { return { sent: true }; },
};
