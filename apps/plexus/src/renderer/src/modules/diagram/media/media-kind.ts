// What a dropped payload becomes on the diagram.
export enum MediaKind
{
    Image     = 'image',     // rendered as a picture
    FileLink  = 'file',      // icon/thumbnail + label chip, opens the file
    Hyperlink = 'hyperlink', // favicon/icon + label chip, opens the URL
}
