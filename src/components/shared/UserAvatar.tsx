type Props = {
  name: string;
  avatarUrl?: string | null;
  className: string;
  imageClassName?: string;
};

export function UserAvatar({ name, avatarUrl, className, imageClassName = "absolute inset-0 h-full w-full object-cover" }: Props) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`}>
      <span aria-hidden="true">{initial}</span>
      {avatarUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className={imageClassName}
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      )}
    </span>
  );
}
