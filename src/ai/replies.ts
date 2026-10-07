/**
 * The two buttons the server offers with a question that needs a yes or a no ("There is no database yet. Should I add one?").
 * They are ordinary replies: typing the same words does exactly the same. The server recognises them (see server ai/application/confirm.ts),
 * so a click on one of these is sent straight away instead of being put in the box for editing.
 */
export const YES_OPTION = 'Yes, add it';
export const NO_OPTION = 'No, leave it as it is';
export const isReplyOption = (text: string): boolean => text === YES_OPTION || text === NO_OPTION;
