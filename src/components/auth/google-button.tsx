import { Button } from "@/components/ui/button";
import { signInWithGoogle } from "@/lib/auth/actions";

export function GoogleSignInButton({ next }: { next?: string }) {
  return (
    <form action={signInWithGoogle}>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Button type="submit" variant="outline" className="w-full">
        Continue with Google
      </Button>
    </form>
  );
}
