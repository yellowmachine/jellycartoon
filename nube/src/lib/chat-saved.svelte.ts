/**
 * The recipe just saved from the chat (#470), for Recetas to point it out in its list for a few
 * seconds when it is open beside the panel: the page stays where it is, it does not take there.
 */
export const justSaved = $state<{ recipeId: number | null }>({ recipeId: null });
